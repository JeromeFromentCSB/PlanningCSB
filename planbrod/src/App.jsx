import { useState, useEffect, useCallback, useRef } from "react";
import { db, auth } from "./firebase.js";
import { ref, onValue, push, remove, update } from "firebase/database";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── Constantes ───────────────────────────────────────────────────────────────
const MACHINES = [
  { id:"M1", label:"Mono #1",  type:"mono",  color:"#E07A5F" },
  { id:"M2", label:"Mono #2",  type:"mono",  color:"#E07A5F" },
  { id:"M3", label:"Mono #3",  type:"mono",  color:"#E07A5F" },
  { id:"M4", label:"Mono #4",  type:"mono",  color:"#E07A5F" },
  { id:"T1", label:"Multi #1", type:"multi", color:"#3D405B" },
  { id:"T2", label:"Multi #2", type:"multi", color:"#3D405B" },
  { id:"T3", label:"Multi #3", type:"multi", color:"#3D405B" },
];
const DAYS_FR    = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const DAYS_SHORT = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MONTHS_FR  = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

const DEFAULT_HOURS = {
  1:{start:8,end:18,active:true},
  2:{start:8,end:18,active:true},
  3:{start:8,end:18,active:true},
  4:{start:8,end:18,active:true},
  5:{start:8,end:18,active:true},
  6:{start:8,end:13,active:false},
};

const STATUS_COLORS = {
  "En attente":{bg:"#FFF3CD",text:"#856404",border:"#FFDA6A"},
  "En cours"  :{bg:"#D1E7DD",text:"#0F5132",border:"#A3CFBB"},
  "Termine"   :{bg:"#E2E3E5",text:"#41464B",border:"#BCBEBF"},
  "Urgent"    :{bg:"#F8D7DA",text:"#842029",border:"#F1AEB5"},
};
const STATUS_LABELS = {"En attente":"En attente","En cours":"En cours","Termine":"Terminé","Urgent":"Urgent"};
const JOB_COLORS    = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6B9AC4","#D4A5A5","#9BB7D4","#C3B1E1","#A8D5BA","#F4A261"];
const ROLE_LABELS   = {admin:"Administrateur",operateur:"Opérateur",lecteur:"Lecteur"};
const CAN = {
  admin    :{add:true, edit:true, delete:true, manage:true },
  operateur:{add:true, edit:true, delete:false,manage:false},
  lecteur  :{add:false,edit:false,delete:false,manage:false},
};
const SNAP_MIN = 5; // granularité drag en minutes
const PX_PER_MIN = 2; // pixels par minute (zoom timeline)

// ─── Helpers temps ─────────────────────────────────────────────────────────────
const timeToMin = (t) => { if(!t)return 0; const[h,m]=t.split(":").map(Number); return h*60+(m||0); };
const minToTime = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const snapMin   = (m) => Math.round(m/SNAP_MIN)*SNAP_MIN;
const fmtTime   = (t) => { if(!t)return""; const[h,m]=t.split(":").map(Number); return m===0?`${h}h`:`${h}h${String(m).padStart(2,"0")}`; };
const fmtDuration=(min)=>{ const h=Math.floor(min/60),m=min%60; return h>0?(m>0?`${h}h${String(m).padStart(2,"0")}`:`${h}h`):`${m}min`; };

// ─── Helpers date ──────────────────────────────────────────────────────────────
const dateToKey = (d)   => d.toISOString().slice(0,10);
const todayKey  = ()    => dateToKey(new Date());
const offsetDate= (k,n) => { const d=new Date(k+"T12:00:00"); d.setDate(d.getDate()+n); return dateToKey(d); };
const getDayIdx = (k)   => new Date(k+"T12:00:00").getDay();
const formatDateFR  = (k) => { const d=new Date(k+"T12:00:00"); return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`; };
const formatShortFR = (k) => { const d=new Date(k+"T12:00:00"); return `${DAYS_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`; };
const getMondayKey  = (k) => { const d=new Date(k+"T12:00:00"),day=d.getDay(),diff=d.getDate()-day+(day===0?-6:1); d.setDate(diff); return dateToKey(d); };
const getWeekKeys   = (mk)=> Array.from({length:6},(_,i)=>offsetDate(mk,i));
const isToday       = (k) => k===todayKey();
const randColor     = ()  => JOB_COLORS[Math.floor(Math.random()*JOB_COLORS.length)];
const fmtDT         = (ts)=> new Date(ts).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser,     setAuthUser]     = useState(undefined);
  const [userProfile,  setUserProfile]  = useState(null);
  const [jobs,         setJobs]         = useState({});
  const [weekJobs,     setWeekJobs]     = useState({});
  const [workingHours, setWorkingHours] = useState(DEFAULT_HOURS);
  const [notifs,       setNotifs]       = useState({});
  const [allUsers,     setAllUsers]     = useState({});
  const [dateKey,      setDateKey]      = useState(todayKey());
  const [modal,        setModal]        = useState(null);
  const [form,         setForm]         = useState({});
  const [view,         setView]         = useState("planning");
  const [showNotifs,   setShowNotifs]   = useState(false);
  const [showAdmin,    setShowAdmin]    = useState(false);
  const [draggingJob,  setDraggingJob]  = useState(null); // { job, dk }
  const [dragOverMachine,setDragOverMachine]=useState(null); // { machineId, dk }
  const [loginErr,     setLoginErr]     = useState("");

  // ── Auth ─────────────────────────────────────────────────────────
  useEffect(()=>{
    return onAuthStateChanged(auth,(u)=>{
      setAuthUser(u||null);
      if(!u){setUserProfile(null);return;}
      onValue(ref(db,`users/${u.uid}`),(snap)=>{
        const data=snap.val();
        if(data)setUserProfile(data);
        else{ const p={email:u.email,name:u.email.split("@")[0],role:"operateur"}; update(ref(db,`users/${u.uid}`),p); setUserProfile(p); }
      });
    });
  },[]);

  // ── Horaires ──────────────────────────────────────────────────────
  useEffect(()=>{
    if(!authUser)return;
    return onValue(ref(db,"settings/workingHours"),(snap)=>{
      const d=snap.val(); if(d) setWorkingHours({...DEFAULT_HOURS,...d});
    });
  },[authUser]);

  // ── Jobs du jour ──────────────────────────────────────────────────
  useEffect(()=>{
    if(!authUser)return;
    return onValue(ref(db,`days/${dateKey}/jobs`),(snap)=>setJobs(snap.val()||{}));
  },[dateKey,authUser]);

  // ── Jobs semaine ──────────────────────────────────────────────────
  useEffect(()=>{
    if(!authUser||view!=="semaine")return;
    const monday=getMondayKey(dateKey), keys=getWeekKeys(monday);
    const unsubs=keys.map(k=>onValue(ref(db,`days/${k}/jobs`),(snap)=>{
      setWeekJobs(prev=>({...prev,[k]:snap.val()||{}}));
    }));
    return ()=>unsubs.forEach(u=>u());
  },[authUser,view,dateKey]);

  // ── Notifs / Users ────────────────────────────────────────────────
  useEffect(()=>{ if(!authUser||userProfile?.role!=="admin")return; return onValue(ref(db,"notifications"),(snap)=>setNotifs(snap.val()||{})); },[authUser,userProfile?.role]);
  useEffect(()=>{ if(!authUser||userProfile?.role!=="admin")return; return onValue(ref(db,"users"),(snap)=>setAllUsers(snap.val()||{})); },[authUser,userProfile?.role]);

  const logChange=useCallback(async(action,details)=>{
    if(!authUser||!userProfile)return;
    await push(ref(db,"notifications"),{ts:Date.now(),action,details,user:userProfile.name||userProfile.email,role:userProfile.role,read:false});
  },[authUser,userProfile]);

  // ── Helpers horaires du jour ───────────────────────────────────────
  const role=userProfile?.role||"lecteur";
  const can =CAN[role]||CAN.lecteur;
  const getDayBounds=(dk)=>{
    const wh=workingHours[getDayIdx(dk)]||{start:8,end:18};
    return {startMin:wh.start*60,endMin:wh.end*60};
  };

  // ── CRUD ──────────────────────────────────────────────────────────
  const openAdd=(machineId,startTime,dk=dateKey)=>{
    if(!can.add)return;
    const {startMin}=getDayBounds(dk);
    setForm({machineId,startTime:startTime||minToTime(startMin),durationMin:60,client:"",description:"",status:"En attente",couleur:randColor(),_dk:dk});
    setModal({type:"add"});
  };
  const openEdit=(job,dk=dateKey)=>{
    if(!can.edit&&!can.delete)return;
    setForm({...job,_dk:dk}); setModal({type:"edit"});
  };
  const saveJob=async()=>{
    if(!form.client.trim())return;
    const{key,_dk,...data}=form; const dk=_dk||dateKey;
    const m=MACHINES.find(x=>x.id===data.machineId);
    const endTime=fmtTime(minToTime(timeToMin(data.startTime)+data.durationMin));
    if(modal.type==="add"){
      await push(ref(db,`days/${dk}/jobs`),data);
      await logChange("ajout",`Ajout "${data.client}" sur ${m?.label}, ${formatShortFR(dk)} ${fmtTime(data.startTime)}→${endTime}`);
    } else {
      await update(ref(db,`days/${dk}/jobs/${key}`),data);
      await logChange("modification",`Modif "${data.client}" → ${m?.label}, ${formatShortFR(dk)} ${fmtTime(data.startTime)}→${endTime}, ${STATUS_LABELS[data.status]}`);
    }
    setModal(null);
  };
  const deleteJob=async(key,job,dk=dateKey)=>{
    if(!can.delete)return;
    const m=MACHINES.find(x=>x.id===job.machineId);
    await remove(ref(db,`days/${dk}/jobs/${key}`));
    await logChange("suppression",`Suppression "${job.client}" de ${m?.label}`);
    setModal(null);
  };

  // ── Drag & drop ───────────────────────────────────────────────────
  const handleDragStart=(job,dk)=>{ if(!can.edit)return; setDraggingJob({job,dk}); };
  const handleDragEnd=()=>{ setDraggingJob(null); setDragOverMachine(null); };

  const handleDrop=async(machineId,newStartTime,dk)=>{
    if(!draggingJob||!can.edit)return;
    const{job,dk:fromDk}=draggingJob;
    const fromM=MACHINES.find(x=>x.id===job.machineId);
    const toM  =MACHINES.find(x=>x.id===machineId);
    if(fromDk!==dk){
      await push(ref(db,`days/${dk}/jobs`),{...job,machineId,startTime:newStartTime,key:undefined});
      await remove(ref(db,`days/${fromDk}/jobs/${job.key}`));
    } else {
      await update(ref(db,`days/${fromDk}/jobs/${job.key}`),{machineId,startTime:newStartTime});
    }
    await logChange("deplacement",`Déplacement "${job.client}" : ${fromM?.label} ${formatShortFR(fromDk)} ${fmtTime(job.startTime)} → ${toM?.label} ${formatShortFR(dk)} ${fmtTime(newStartTime)}`);
    setDraggingJob(null); setDragOverMachine(null);
  };

  const markAllRead=async()=>{ const u={}; Object.keys(notifs).forEach(k=>{u[`notifications/${k}/read`]=true;}); await update(ref(db),u); };
  const deleteNotif=async(k)=>remove(ref(db,`notifications/${k}`));

  const jobsList    =Object.entries(jobs).map(([key,val])=>({...val,key}));
  const notifsList  =Object.entries(notifs).map(([key,val])=>({...val,key})).sort((a,b)=>b.ts-a.ts);
  const unreadCount =notifsList.filter(n=>!n.read).length;
  const monoMachines=MACHINES.filter(m=>m.type==="mono");
  const multiMachines=MACHINES.filter(m=>m.type==="multi");

  const dragProps={draggingJob,dragOverMachine,setDragOverMachine,handleDragStart,handleDragEnd,handleDrop,can};

  if(authUser===undefined)return<Loader/>;
  if(!authUser)return<LoginScreen error={loginErr} onLogin={async(email,pass)=>{ try{setLoginErr("");await signInWithEmailAndPassword(auth,email,pass);}catch{setLoginErr("Email ou mot de passe incorrect.");} }}/>;

  const {startMin:dayStartMin,endMin:dayEndMin}=getDayBounds(dateKey);
  const dayIsActive=workingHours[getDayIdx(dateKey)]?.active!==false;

  return(
    <div style={{fontFamily:"'Segoe UI',sans-serif",background:"#F7F4F0",minHeight:"100vh"}}>

      {/* Header */}
      <div style={{background:"#1A1A2E",color:"white",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 12px rgba(0,0,0,0.2)",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>🧵</span>
          <div>
            <div style={{fontSize:17,fontWeight:700}}>PlanBrod</div>
            <div style={{fontSize:10,color:"#A0AEC0"}}>{userProfile?.name||userProfile?.email} · <span style={{color:role==="admin"?"#F2CC8F":role==="operateur"?"#81B29A":"#A0AEC0"}}>{ROLE_LABELS[role]}</span></div>
          </div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button onClick={()=>setDateKey(k=>offsetDate(k,view==="semaine"?-7:-1))} style={navBtn}>‹</button>
          <div style={{textAlign:"center",minWidth:150}}>
            {view==="semaine"
              ?<div style={{color:"white",fontSize:11,fontWeight:600}}>Semaine du {formatShortFR(getMondayKey(dateKey))}</div>
              :<><div style={{color:"white",fontSize:11,fontWeight:600}}>{formatDateFR(dateKey)}</div>{isToday(dateKey)&&<div style={{fontSize:10,color:"#81B29A",fontWeight:600}}>Aujourd'hui</div>}</>
            }
          </div>
          <button onClick={()=>setDateKey(k=>offsetDate(k,view==="semaine"?7:1))} style={navBtn}>›</button>
          <button onClick={()=>setDateKey(todayKey())} style={{...navBtn,fontSize:10,width:"auto",padding:"0 8px"}}>Auj.</button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {[["planning","📅 Jour"],["semaine","📆 Semaine"],["recap","📊 Récap"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"#E07A5F":"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:7,padding:"6px 11px",fontWeight:600,cursor:"pointer",fontSize:11}}>{label}</button>
          ))}
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {role==="admin"&&<button onClick={()=>{setShowNotifs(v=>!v);setShowAdmin(false);}} style={{...iconBtn,position:"relative"}}>🔔{unreadCount>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#E07A5F",color:"white",borderRadius:99,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{unreadCount}</span>}</button>}
          {role==="admin"&&<button onClick={()=>{setShowAdmin(v=>!v);setShowNotifs(false);}} style={iconBtn}>⚙️</button>}
          <button onClick={()=>signOut(auth)} style={{...iconBtn,opacity:0.7}}>🚪</button>
        </div>
      </div>

      {showNotifs&&role==="admin"&&<NotifPanel notifs={notifsList} onMarkRead={markAllRead} onDelete={deleteNotif} onClose={()=>setShowNotifs(false)}/>}
      {showAdmin &&role==="admin"&&<AdminPanel allUsers={allUsers} workingHours={workingHours} onClose={()=>setShowAdmin(false)}/>}

      {view==="planning"&&(
        <PlanningView monoMachines={monoMachines} multiMachines={multiMachines} jobs={jobsList}
          openAdd={openAdd} openEdit={openEdit} dateKey={dateKey}
          dayStartMin={dayStartMin} dayEndMin={dayEndMin} dayIsActive={dayIsActive}
          {...dragProps}/>
      )}
      {view==="semaine"&&(
        <WeekView monoMachines={monoMachines} multiMachines={multiMachines}
          weekJobs={weekJobs} openAdd={openAdd} openEdit={openEdit}
          mondayKey={getMondayKey(dateKey)} workingHours={workingHours}
          onDayClick={(dk)=>{setDateKey(dk);setView("planning");}}
          {...dragProps}/>
      )}
      {view==="recap"&&<RecapView jobs={jobsList} machines={MACHINES} dateKey={dateKey}/>}

      {/* Modal */}
      {modal&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:24,width:390,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#1A1A2E"}}>{modal.type==="add"?"➕ Nouvelle commande":"✏️ Modifier"}</div>
            {modal.type==="edit"&&!can.delete&&<div style={{background:"#FFF3CD",border:"1px solid #FFDA6A",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#856404",marginBottom:12}}>ℹ️ Votre rôle ne permet pas la suppression.</div>}

            {[{label:"Client *",key:"client",ph:"Nom du client"},{label:"Description",key:"description",ph:"Ex: Polos x30"}].map(({label,key,ph})=>(
              <div key={key} style={{marginBottom:10}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>{label}</label>
                <input value={form[key]||""} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}}/>
              </div>
            ))}

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Machine</label>
                <select value={form.machineId||"M1"} onChange={e=>setForm(f=>({...f,machineId:e.target.value}))} style={selStyle}>
                  {MACHINES.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Statut</label>
                <select value={form.status||"En attente"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={selStyle}>
                  {Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:18}}>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Heure de début</label>
                <input type="time" value={form.startTime||"08:00"} onChange={e=>setForm(f=>({...f,startTime:e.target.value}))}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}}/>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Durée</label>
                <div style={{display:"flex",gap:5}}>
                  <select value={Math.floor((form.durationMin||60)/60)} onChange={e=>{
                    const h=+e.target.value, m=(form.durationMin||60)%60;
                    setForm(f=>({...f,durationMin:h*60+m}));
                  }} style={{...selStyle,flex:1}}>
                    {[0,1,2,3,4,5,6,7,8].map(h=><option key={h} value={h}>{h}h</option>)}
                  </select>
                  <select value={(form.durationMin||60)%60} onChange={e=>{
                    const h=Math.floor((form.durationMin||60)/60), m=+e.target.value;
                    setForm(f=>({...f,durationMin:h*60+m}));
                  }} style={{...selStyle,flex:1}}>
                    {[0,5,10,15,20,25,30,35,40,45,50,55].map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}min</option>)}
                  </select>
                </div>
                {form.startTime&&form.durationMin>0&&(
                  <div style={{fontSize:10,color:"#718096",marginTop:3}}>
                    → fin à <strong>{fmtTime(minToTime(timeToMin(form.startTime)+(form.durationMin||60)))}</strong> ({fmtDuration(form.durationMin||60)})
                  </div>
                )}
              </div>
            </div>

            <div style={{display:"flex",gap:8}}>
              {modal.type==="edit"&&can.delete&&<button onClick={()=>deleteJob(form.key,form,form._dk||dateKey)} style={{padding:"9px 13px",borderRadius:8,border:"none",background:"#FEE2E2",color:"#991B1B",fontWeight:600,cursor:"pointer"}}>🗑</button>}
              <button onClick={()=>setModal(null)} style={{flex:1,padding:"9px",borderRadius:8,border:"1.5px solid #E2E8F0",background:"white",fontWeight:600,cursor:"pointer",fontSize:12}}>Annuler</button>
              <button onClick={saveJob} disabled={!form.client?.trim()||(form.durationMin||0)===0}
                style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:(form.client?.trim()&&(form.durationMin||0)>0)?"#1A1A2E":"#CBD5E0",color:"white",fontWeight:700,cursor:(form.client?.trim()&&(form.durationMin||0)>0)?"pointer":"default",fontSize:12}}>
                {modal.type==="add"?"Ajouter":"Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Vue Jour ──────────────────────────────────────────────────────────────────
function PlanningView({monoMachines,multiMachines,jobs,openAdd,openEdit,dateKey,dayStartMin,dayEndMin,dayIsActive,...dragProps}){
  const byStatus=Object.keys(STATUS_COLORS).reduce((acc,s)=>{acc[s]=jobs.filter(j=>j.status===s).length;return acc;},{});
  return(
    <div style={{padding:"14px 10px"}}>
      {!dayIsActive&&<div style={{background:"#FFF3CD",border:"1px solid #FFDA6A",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#856404",fontWeight:600}}>⚠️ Ce jour est marqué comme non travaillé dans les paramètres admin.</div>}
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {[{label:"Total",value:jobs.length,icon:"📋",bg:"#1A1A2E",color:"white"},
          ...Object.entries(byStatus).map(([s,n])=>({label:STATUS_LABELS[s],value:n,icon:s==="En cours"?"⚙️":s==="Urgent"?"🚨":s==="Termine"?"✅":"⏳",bg:STATUS_COLORS[s].bg,color:STATUS_COLORS[s].text}))
        ].map(({label,value,icon,bg,color})=>(
          <div key={label} style={{background:bg,color,borderRadius:9,padding:"6px 11px",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:11,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
            <span>{icon}</span><span style={{fontSize:14,fontWeight:800}}>{value}</span><span style={{opacity:0.8}}>{label}</span>
          </div>
        ))}
        {dragProps.can.edit&&<div style={{marginLeft:"auto",fontSize:11,color:"#A0AEC0",fontStyle:"italic"}}>✋ Glissez à la minute près (snap 5min)</div>}
      </div>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <TimelineGrid label="🪡 Mono-Têtes" machines={monoMachines} jobs={jobs} openAdd={(m,t)=>openAdd(m,t,dateKey)} openEdit={(j)=>openEdit(j,dateKey)} headerColor="#E07A5F" dayStartMin={dayStartMin} dayEndMin={dayEndMin} dateKey={dateKey} {...dragProps}/>
        <div style={{height:1,background:"#F0EDE8"}}/>
        <TimelineGrid label="🎛 Multi-Têtes" machines={multiMachines} jobs={jobs} openAdd={(m,t)=>openAdd(m,t,dateKey)} openEdit={(j)=>openEdit(j,dateKey)} headerColor="#3D405B" dayStartMin={dayStartMin} dayEndMin={dayEndMin} dateKey={dateKey} {...dragProps}/>
      </div>
      <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"#A0AEC0"}}>Clic sur la timeline = ajouter à cet horaire · Clic tâche = modifier · Glisser = déplacer (snap 5 min)</div>
    </div>
  );
}

// ─── Timeline pixel ────────────────────────────────────────────────────────────
function TimelineGrid({label,machines,jobs,openAdd,openEdit,headerColor,dayStartMin,dayEndMin,dateKey,draggingJob,dragOverMachine,setDragOverMachine,handleDragStart,handleDragEnd,handleDrop,can}){
  const dayDuration = dayEndMin - dayStartMin;
  const timelineW   = dayDuration * PX_PER_MIN; // pixels total
  const LABEL_W     = 90;
  const ROW_H       = 64;

  // Marqueurs horaires
  const hourMarkers = [];
  for(let m=dayStartMin;m<=dayEndMin;m+=60) hourMarkers.push(m);
  const halfMarkers = [];
  for(let m=dayStartMin+30;m<dayEndMin;m+=60) halfMarkers.push(m);

  const toLeft   = (min) => ((min-dayStartMin)/dayDuration)*timelineW;
  const toWidth  = (dur) => (dur/dayDuration)*timelineW;
  const fromLeft = (px)  => snapMin(dayStartMin + (px/timelineW)*dayDuration);

  const isDragging = draggingJob!=null;

  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{overflowX:"auto"}}>
        <div style={{display:"flex",minWidth:LABEL_W+timelineW}}>

          {/* Colonne labels */}
          <div style={{width:LABEL_W,flexShrink:0,borderRight:"1px solid #F0EDE8"}}>
            {/* Spacer header */}
            <div style={{height:28,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8"}}/>
            {machines.map((m,mi)=>(
              <div key={m.id} style={{height:ROW_H,display:"flex",alignItems:"center",padding:"0 10px",background:mi%2===0?"white":"#FDFCFB",borderBottom:"1px solid #F7F4F0"}}>
                <div style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                  <span style={{fontSize:11,fontWeight:600,color:"#2D3748",whiteSpace:"nowrap"}}>{m.label}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Timeline */}
          <div style={{position:"relative",width:timelineW,flexShrink:0}}>

            {/* En-tête heures */}
            <div style={{height:28,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"relative"}}>
              {hourMarkers.map(m=>(
                <div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:m===dayStartMin?"none":"1px solid #E2E8F0",display:"flex",alignItems:"center",paddingLeft:4}}>
                  <span style={{fontSize:10,fontWeight:600,color:"#718096",whiteSpace:"nowrap"}}>{fmtTime(minToTime(m))}</span>
                </div>
              ))}
            </div>

            {/* Lignes machines */}
            {machines.map((machine,mi)=>{
              const mJobs=jobs.filter(j=>j.machineId===machine.id);
              const isOver=dragOverMachine?.machineId===machine.id&&dragOverMachine?.dk===dateKey;
              return(
                <div key={machine.id}
                  style={{height:ROW_H,position:"relative",background:isOver?(mi%2===0?"#EBF4FF":"#E6F0FF"):(mi%2===0?"white":"#FDFCFB"),borderBottom:"1px solid #F7F4F0",transition:"background .1s"}}
                  onDragOver={e=>{ e.preventDefault(); if(can.edit) setDragOverMachine({machineId:machine.id,dk:dateKey}); }}
                  onDragLeave={()=>setDragOverMachine(null)}
                  onDrop={e=>{
                    e.preventDefault();
                    if(!draggingJob||!can.edit)return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const x=e.clientX-rect.left;
                    const rawMin=dayStartMin+(x/timelineW)*dayDuration;
                    const snapped=Math.max(dayStartMin,Math.min(dayEndMin-5,snapMin(rawMin)));
                    handleDrop(machine.id,minToTime(snapped),dateKey);
                  }}
                  onClick={e=>{
                    if(isDragging||!can.add)return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const x=e.clientX-rect.left;
                    const rawMin=dayStartMin+(x/timelineW)*dayDuration;
                    const snapped=Math.max(dayStartMin,Math.min(dayEndMin-5,snapMin(rawMin)));
                    openAdd(machine.id,minToTime(snapped));
                  }}
                >
                  {/* Lignes demi-heures */}
                  {halfMarkers.map(m=><div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:"1px dashed #F0EDE8",pointerEvents:"none"}}/>)}
                  {/* Lignes heures */}
                  {hourMarkers.filter(m=>m>dayStartMin).map(m=><div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:"1px solid #E8E8E8",pointerEvents:"none"}}/>)}

                  {/* Tâches */}
                  {mJobs.map(job=>{
                    const startMin=timeToMin(job.startTime);
                    const left    =toLeft(startMin);
                    const width   =Math.max(toWidth(job.durationMin),24);
                    const sc      =STATUS_COLORS[job.status];
                    const isGhost =draggingJob?.job?.key===job.key;
                    const endTime =minToTime(startMin+job.durationMin);
                    return(
                      <div key={job.key}
                        draggable={can.edit}
                        onDragStart={e=>{ e.stopPropagation(); handleDragStart(job,dateKey); }}
                        onDragEnd={handleDragEnd}
                        onClick={e=>{ e.stopPropagation(); if(!isDragging) openEdit(job); }}
                        title={`${job.client}${job.description?" – "+job.description:""}\n${fmtTime(job.startTime)} → ${fmtTime(endTime)} (${fmtDuration(job.durationMin)})`}
                        style={{
                          position:"absolute",
                          left:left,
                          width:width-2,
                          top:5,bottom:5,
                          background:sc.bg,
                          border:`1.5px solid ${sc.border}`,
                          borderLeft:`3px solid ${job.couleur}`,
                          borderRadius:6,
                          padding:"3px 6px",
                          overflow:"hidden",
                          cursor:can.edit?(isDragging?"grabbing":"grab"):"pointer",
                          opacity:isGhost?0.25:1,
                          transition:"opacity .15s,box-shadow .1s",
                          userSelect:"none",
                          zIndex:1,
                        }}
                        onMouseEnter={e=>{ if(!isDragging&&can.edit) e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.18)"; e.currentTarget.style.zIndex=10; }}
                        onMouseLeave={e=>{ e.currentTarget.style.boxShadow="none"; e.currentTarget.style.zIndex=1; }}
                      >
                        <div style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.client}</div>
                        {width>80&&<div style={{fontSize:10,color:sc.text,opacity:0.55,whiteSpace:"nowrap"}}>{fmtTime(job.startTime)}→{fmtTime(endTime)}</div>}
                      </div>
                    );
                  })}

                  {/* Indicateur drag over */}
                  {isOver&&can.edit&&<div style={{position:"absolute",inset:0,border:"2px dashed #6B9AC4",borderRadius:4,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:11,fontWeight:700,color:"#6B9AC4"}}>Déposer ici</span></div>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Vue Semaine ───────────────────────────────────────────────────────────────
function WeekView({monoMachines,multiMachines,weekJobs,openAdd,openEdit,mondayKey,workingHours,onDayClick,draggingJob,setDragOverMachine,handleDragStart,handleDragEnd,handleDrop,can}){
  const weekKeys   =getWeekKeys(mondayKey);
  const activeDays =weekKeys.filter(k=>workingHours[getDayIdx(k)]?.active!==false);
  return(
    <div style={{padding:"14px 10px"}}>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <WeekGrid label="🪡 Mono-Têtes" machines={monoMachines} weekKeys={activeDays} weekJobs={weekJobs} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" onDayClick={onDayClick} draggingJob={draggingJob} setDragOverMachine={setDragOverMachine} handleDragStart={handleDragStart} handleDragEnd={handleDragEnd} handleDrop={handleDrop} can={can}/>
        <div style={{height:1,background:"#F0EDE8"}}/>
        <WeekGrid label="🎛 Multi-Têtes" machines={multiMachines} weekKeys={activeDays} weekJobs={weekJobs} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" onDayClick={onDayClick} draggingJob={draggingJob} setDragOverMachine={setDragOverMachine} handleDragStart={handleDragStart} handleDragEnd={handleDragEnd} handleDrop={handleDrop} can={can}/>
      </div>
      <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"#A0AEC0"}}>Clic sur un jour = vue détaillée · Clic sur tâche = modifier · Glisser entre jours</div>
    </div>
  );
}

function WeekGrid({label,machines,weekKeys,weekJobs,openAdd,openEdit,headerColor,onDayClick,draggingJob,setDragOverMachine,handleDragStart,handleDragEnd,handleDrop,can}){
  const isDragging=draggingJob!=null;
  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
          <thead><tr>
            <th style={{width:88,padding:"8px 11px",textAlign:"left",fontSize:11,color:"#718096",fontWeight:600,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"sticky",left:0,zIndex:2}}>Machine</th>
            {weekKeys.map(dk=>(
              <th key={dk} onClick={()=>onDayClick(dk)} style={{padding:"8px 6px",fontSize:11,color:isToday(dk)?"#E07A5F":"#718096",fontWeight:isToday(dk)?800:600,background:isToday(dk)?"#FFF5F3":"#FAFAF8",borderBottom:"1px solid #F0EDE8",textAlign:"center",cursor:"pointer",borderLeft:"1px solid #F0EDE8",minWidth:105}}>
                <div>{DAYS_FR[getDayIdx(dk)]}</div>
                <div style={{fontSize:10,fontWeight:400,color:isToday(dk)?"#E07A5F":"#A0AEC0"}}>{formatShortFR(dk)}</div>
                {isToday(dk)&&<div style={{fontSize:9,color:"#E07A5F",fontWeight:700}}>Aujourd'hui</div>}
              </th>
            ))}
          </tr></thead>
          <tbody>
            {machines.map((machine,mi)=>(
              <tr key={machine.id} style={{background:mi%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"8px 11px",fontWeight:600,fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0",whiteSpace:"nowrap",position:"sticky",left:0,background:mi%2===0?"white":"#FDFCFB",zIndex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:machine.color}}/>{machine.label}</div>
                </td>
                {weekKeys.map(dk=>{
                  const dayJobsList=Object.entries(weekJobs[dk]||{}).map(([key,val])=>({...val,key})).filter(j=>j.machineId===machine.id);
                  return(
                    <td key={dk}
                      onClick={()=>{ if(!isDragging&&can.add) openAdd(machine.id,"08:00",dk); }}
                      onDragOver={e=>{ e.preventDefault(); if(can.edit) setDragOverMachine({machineId:machine.id,dk}); }}
                      onDragLeave={()=>setDragOverMachine(null)}
                      onDrop={e=>{ e.preventDefault(); if(draggingJob&&can.edit) handleDrop(machine.id,draggingJob.job.startTime,dk); }}
                      style={{padding:5,verticalAlign:"top",borderBottom:"1px solid #F7F4F0",borderLeft:"1px solid #F0EDE8",minWidth:105,minHeight:60,cursor:isDragging&&can.edit?"copy":can.add?"cell":"default",background:isToday(dk)?"#FDFCFA":"transparent"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:3,minHeight:54}}>
                        {dayJobsList.sort((a,b)=>timeToMin(a.startTime)-timeToMin(b.startTime)).map(job=>{
                          const sc=STATUS_COLORS[job.status];
                          return(
                            <div key={job.key} draggable={can.edit}
                              onDragStart={e=>{e.stopPropagation();handleDragStart(job,dk);}}
                              onDragEnd={handleDragEnd}
                              onClick={e=>{e.stopPropagation();if(!isDragging)openEdit(job,dk);}}
                              style={{background:sc.bg,border:`1.5px solid ${sc.border}`,borderLeft:`3px solid ${job.couleur}`,borderRadius:6,padding:"3px 6px",cursor:can.edit?"grab":"default",userSelect:"none"}}
                              onMouseEnter={e=>{if(can.edit)e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.12)";}}
                              onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
                              <div style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.client}</div>
                              <div style={{fontSize:10,color:sc.text,opacity:0.6}}>{fmtTime(job.startTime)} · {fmtDuration(job.durationMin)}</div>
                            </div>
                          );
                        })}
                        {dayJobsList.length===0&&can.add&&<div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:"#E8E8E8",fontSize:18,pointerEvents:"none"}}>+</div>}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Récap ──────────────────────────────────────────────────────────────────
function RecapView({jobs,machines,dateKey}){
  const stats=machines.map(m=>{const mj=jobs.filter(j=>j.machineId===m.id);return{...m,mj,total:mj.reduce((a,j)=>a+(j.durationMin||60),0)};});
  const maxH=Math.max(...stats.map(m=>m.total),1);
  return(
    <div style={{padding:"14px 10px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#1A1A2E",marginBottom:12}}>📊 Récap — {formatDateFR(dateKey)}</div>
      <div style={{background:"white",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#4A5568",marginBottom:10}}>Charge par machine</div>
        {stats.map(m=>(
          <div key={m.id} style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
              <span style={{fontWeight:600,color:"#2D3748"}}>{m.label}</span>
              <span style={{color:"#718096"}}>{fmtDuration(m.total)} · {m.mj.length} commande{m.mj.length!==1?"s":""}</span>
            </div>
            <div style={{height:7,background:"#F0EDE8",borderRadius:99,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${Math.min((m.total/maxH)*100,100)}%`,background:m.color,borderRadius:99}}/>
            </div>
          </div>
        ))}
      </div>
      {jobs.filter(j=>j.status==="Urgent").length>0&&(
        <div style={{background:"#FFF5F5",border:"1.5px solid #FEB2B2",borderRadius:14,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#C53030",marginBottom:6}}>🚨 Urgents</div>
          {jobs.filter(j=>j.status==="Urgent").map(job=>{const m=machines.find(m=>m.id===job.machineId);return<div key={job.key} style={{fontSize:12,color:"#742A2A",marginBottom:2}}><strong>{job.client}</strong> — {job.description||"–"} ({m?.label}, {fmtTime(job.startTime)} {fmtDuration(job.durationMin)})</div>;})}
        </div>
      )}
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{padding:"10px 14px",background:"#1A1A2E",color:"white",fontWeight:700,fontSize:12}}>Toutes les commandes ({jobs.length})</div>
        {jobs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune commande ce jour</div>:(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#FAFAF8"}}>{["Client","Description","Machine","Début","Fin","Durée","Statut"].map(h=><th key={h} style={{padding:"7px 10px",fontSize:11,color:"#718096",fontWeight:600,textAlign:"left",borderBottom:"1px solid #F0EDE8"}}>{h}</th>)}</tr></thead>
            <tbody>{jobs.sort((a,b)=>timeToMin(a.startTime)-timeToMin(b.startTime)).map((job,i)=>{
              const m=machines.find(m=>m.id===job.machineId),sc=STATUS_COLORS[job.status];
              return<tr key={job.key} style={{background:i%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"7px 10px",fontWeight:600,fontSize:12,borderBottom:"1px solid #F7F4F0"}}>{job.client}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#718096",borderBottom:"1px solid #F7F4F0"}}>{job.description||"—"}</td>
                <td style={{padding:"7px 10px",fontSize:11,borderBottom:"1px solid #F7F4F0"}}><span style={{background:m?.color+"20",color:m?.color,padding:"2px 6px",borderRadius:5,fontWeight:600,fontSize:10}}>{m?.label}</span></td>
                <td style={{padding:"7px 10px",fontSize:11,fontWeight:600,color:"#2D3748",borderBottom:"1px solid #F7F4F0"}}>{fmtTime(job.startTime)}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{fmtTime(minToTime(timeToMin(job.startTime)+job.durationMin))}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{fmtDuration(job.durationMin)}</td>
                <td style={{padding:"7px 10px",borderBottom:"1px solid #F7F4F0"}}><span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,padding:"2px 6px",borderRadius:5,fontSize:10,fontWeight:600}}>{STATUS_LABELS[job.status]}</span></td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Admin Panel ───────────────────────────────────────────────────────────────
function AdminPanel({allUsers,workingHours,onClose}){
  const [tab,setTab]=useState("users");
  const DAY_NAMES={1:"Lundi",2:"Mardi",3:"Mercredi",4:"Jeudi",5:"Vendredi",6:"Samedi"};
  const ALL_HOURS=Array.from({length:15},(_,i)=>i+5);
  const saveHours=async(dayIdx,field,value)=>await update(ref(db,`settings/workingHours/${dayIdx}`),{[field]:value});
  return(
    <div style={{position:"fixed",top:62,right:12,width:420,background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,overflow:"hidden",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"11px 14px",background:"#3D405B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>⚙️ Administration</span>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
      </div>
      <div style={{display:"flex",borderBottom:"1px solid #F0EDE8"}}>
        {[["users","👥 Utilisateurs"],["horaires","🕐 Horaires"]].map(([t,label])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px",border:"none",background:tab===t?"white":"#FAFAF8",fontWeight:tab===t?700:400,fontSize:12,cursor:"pointer",color:tab===t?"#1A1A2E":"#718096",borderBottom:tab===t?"2px solid #E07A5F":"2px solid transparent"}}>
            {label}
          </button>
        ))}
      </div>
      <div style={{overflowY:"auto",flex:1,padding:14}}>
        {tab==="users"&&(
          <>
            <div style={{fontSize:11,color:"#718096",marginBottom:10,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}><strong>Admin</strong> : tout + notifs · <strong>Opérateur</strong> : ajouter/modifier · <strong>Lecteur</strong> : consulter</div>
            {Object.entries(allUsers).length===0?<div style={{color:"#A0AEC0",fontSize:12,textAlign:"center",padding:10}}>Aucun utilisateur</div>
            :Object.entries(allUsers).map(([uid,u])=>(
              <div key={uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #F7F4F0"}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#2D3748",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||u.email}</div><div style={{fontSize:10,color:"#A0AEC0"}}>{u.email}</div></div>
                <select value={u.role||"lecteur"} onChange={e=>update(ref(db,`users/${uid}`),{role:e.target.value})}
                  style={{padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,cursor:"pointer",fontWeight:600,background:u.role==="admin"?"#FEFCE8":u.role==="operateur"?"#F0FDF4":"#F9FAFB",color:u.role==="admin"?"#854D0E":u.role==="operateur"?"#166534":"#4B5563"}}>
                  <option value="admin">Administrateur</option><option value="operateur">Opérateur</option><option value="lecteur">Lecteur</option>
                </select>
              </div>
            ))}
          </>
        )}
        {tab==="horaires"&&(
          <>
            <div style={{fontSize:11,color:"#718096",marginBottom:12,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}>Définissez les horaires par jour. Les jours désactivés n'apparaissent pas dans la vue semaine.</div>
            {[1,2,3,4,5,6].map(dayIdx=>{
              const wh=workingHours[dayIdx]||DEFAULT_HOURS[dayIdx]||{start:8,end:18,active:true};
              return(
                <div key={dayIdx} style={{marginBottom:10,padding:"10px 12px",background:wh.active?"white":"#F7F4F0",borderRadius:10,border:`1.5px solid ${wh.active?"#E2E8F0":"#EDE8E3"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:wh.active?10:0}}>
                    <div style={{flex:1,fontWeight:700,fontSize:13,color:wh.active?"#1A1A2E":"#A0AEC0"}}>{DAY_NAMES[dayIdx]}</div>
                    <div onClick={()=>saveHours(dayIdx,"active",!wh.active)} style={{width:38,height:20,borderRadius:99,background:wh.active?"#22C55E":"#CBD5E0",cursor:"pointer",position:"relative",transition:"background .2s"}}>
                      <div style={{position:"absolute",top:2,left:wh.active?20:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                    </div>
                    <span style={{fontSize:11,color:wh.active?"#22C55E":"#A0AEC0",fontWeight:600,minWidth:55}}>{wh.active?"Travaillé":"Repos"}</span>
                  </div>
                  {wh.active&&(
                    <div style={{display:"flex",gap:10,alignItems:"center"}}>
                      <div style={{flex:1}}>
                        <label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Début</label>
                        <select value={wh.start} onChange={e=>saveHours(dayIdx,"start",+e.target.value)} style={{...selStyle,fontSize:12}}>
                          {ALL_HOURS.filter(h=>h<wh.end).map(h=><option key={h} value={h}>{h}h00</option>)}
                        </select>
                      </div>
                      <div style={{color:"#A0AEC0",fontSize:16,marginTop:14}}>→</div>
                      <div style={{flex:1}}>
                        <label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Fin</label>
                        <select value={wh.end} onChange={e=>saveHours(dayIdx,"end",+e.target.value)} style={{...selStyle,fontSize:12}}>
                          {ALL_HOURS.filter(h=>h>wh.start).map(h=><option key={h} value={h}>{h}h00</option>)}
                        </select>
                      </div>
                      <div style={{flex:1}}>
                        <label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Total</label>
                        <div style={{padding:"7px 9px",borderRadius:8,background:"#F7F4F0",fontSize:12,color:"#4A5568",fontWeight:700,textAlign:"center"}}>{wh.end-wh.start}h</div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{fontSize:11,color:"#A0AEC0",textAlign:"center",marginTop:6}}>Modifications appliquées en temps réel sur tous les appareils.</div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Notifs ────────────────────────────────────────────────────────────────────
function NotifPanel({notifs,onMarkRead,onDelete,onClose}){
  return(
    <div style={{position:"fixed",top:62,right:12,width:370,maxHeight:"70vh",background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 14px",background:"#1A1A2E",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>🔔 Modifications du planning</span>
        <div style={{display:"flex",gap:7}}>
          <button onClick={onMarkRead} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11}}>Tout lire</button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
        </div>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {notifs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune notification</div>
        :notifs.map(n=>{
          const icon=n.action==="ajout"?"➕":n.action==="suppression"?"🗑":n.action==="deplacement"?"↔️":"✏️";
          return(
            <div key={n.key} style={{padding:"9px 13px",borderBottom:"1px solid #F7F4F0",background:n.read?"white":"#EBF4FF",display:"flex",gap:9,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:12,color:"#2D3748",lineHeight:1.4}}>{n.details}</div>
                <div style={{fontSize:10,color:"#A0AEC0",marginTop:2}}>{ROLE_LABELS[n.role]||n.role} <strong>{n.user}</strong> · {fmtDT(n.ts)}</div>
              </div>
              {!n.read&&<div style={{width:7,height:7,borderRadius:"50%",background:"#E07A5F",flexShrink:0,marginTop:4}}/>}
              <button onClick={()=>onDelete(n.key)} style={{background:"none",border:"none",cursor:"pointer",color:"#CBD5E0",fontSize:13,flexShrink:0}}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Login & Loader ────────────────────────────────────────────────────────────
function LoginScreen({onLogin,error}){
  const[email,setEmail]=useState("");const[pass,setPass]=useState("");
  return(
    <div style={{minHeight:"100vh",background:"#F7F4F0",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:20,padding:36,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        <div style={{textAlign:"center",marginBottom:22}}><div style={{fontSize:38}}>🧵</div><div style={{fontSize:20,fontWeight:800,color:"#1A1A2E",marginTop:6}}>PlanBrod</div><div style={{fontSize:11,color:"#A0AEC0",marginTop:2}}>Connectez-vous pour accéder au planning</div></div>
        {error&&<div style={{background:"#FEE2E2",color:"#991B1B",borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:12,textAlign:"center"}}>{error}</div>}
        <div style={{marginBottom:11}}><label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="votre@email.com" style={{width:"100%",padding:"9px 11px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}}/></div>
        <div style={{marginBottom:18}}><label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Mot de passe</label><input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&onLogin(email,pass)} style={{width:"100%",padding:"9px 11px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}}/></div>
        <button onClick={()=>onLogin(email,pass)} style={{width:"100%",padding:"10px",borderRadius:9,border:"none",background:"#1A1A2E",color:"white",fontWeight:700,cursor:"pointer",fontSize:13}}>Se connecter</button>
      </div>
    </div>
  );
}
function Loader(){return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:13,color:"#718096",background:"#F7F4F0"}}>⏳ Chargement…</div>;}

const navBtn ={background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:15,fontWeight:700};
const iconBtn={background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:7,width:30,height:30,cursor:"pointer",fontSize:15,position:"relative"};
const selStyle={width:"100%",padding:"7px 9px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:12};
