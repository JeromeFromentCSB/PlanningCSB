import { useState, useEffect, useCallback, useRef } from "react";
import { db, auth } from "./firebase.js";
import { ref, onValue, push, remove, update } from "firebase/database";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── Machines ─────────────────────────────────────────────────────────────────
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
const DEFAULT_WH = { 0:{start:8,end:18,active:false},1:{start:8,end:18,active:true},2:{start:8,end:18,active:true},3:{start:8,end:18,active:true},4:{start:8,end:18,active:true},5:{start:8,end:18,active:true},6:{start:8,end:13,active:false} };
const STATUS_COLORS = {
  "En attente":{bg:"#FFF3CD",text:"#856404",border:"#FFDA6A"},
  "En cours"  :{bg:"#D1E7DD",text:"#0F5132",border:"#A3CFBB"},
  "Termine"   :{bg:"#E2E3E5",text:"#41464B",border:"#BCBEBF"},
  "Urgent"    :{bg:"#F8D7DA",text:"#842029",border:"#F1AEB5"},
};
const STATUS_LABELS = {"En attente":"En attente","En cours":"En cours","Termine":"Terminé","Urgent":"Urgent"};
const JOB_COLORS    = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6B9AC4","#D4A5A5","#9BB7D4","#C3B1E1","#A8D5BA","#F4A261"];
const ROLE_LABELS   = {admin:"Administrateur",operateur:"Opérateur",lecteur:"Lecteur"};
const CAN = { admin:{add:true,edit:true,delete:true,manage:true}, operateur:{add:true,edit:true,delete:false,manage:false}, lecteur:{add:false,edit:false,delete:false,manage:false} };
const SNAP_MIN     = 5;
const MIN_TIMELINE = 300;
const LABEL_W      = 90;
const ROW_H        = 68;

// ─── Helpers temps ─────────────────────────────────────────────────────────────
const timeToMin = (t) => { if(!t)return 0; const[h,m]=t.split(":").map(Number); return h*60+(m||0); };
const minToTime = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const snapMin   = (m) => Math.round(m/SNAP_MIN)*SNAP_MIN;
const fmtTime   = (t) => { if(!t)return""; const[h,m]=t.split(":").map(Number); return m===0?`${h}h`:`${h}h${String(m).padStart(2,"0")}`; };
const fmtDur    = (m) => { if(!m)return"0min"; const h=Math.floor(m/60),r=m%60; return h>0?(r>0?`${h}h${String(r).padStart(2,"0")}`:`${h}h`):`${r}min`; };

// ─── Helpers date ──────────────────────────────────────────────────────────────
const dateToKey     = (d)   => d.toISOString().slice(0,10);
const todayKey      = ()    => dateToKey(new Date());
const offsetDate    = (k,n) => { const d=new Date(k+"T12:00:00"); d.setDate(d.getDate()+n); return dateToKey(d); };
const getDayIdx     = (k)   => new Date(k+"T12:00:00").getDay();
const getMondayKey  = (k)   => { const d=new Date(k+"T12:00:00"),dy=d.getDay(),df=d.getDate()-dy+(dy===0?-6:1); d.setDate(df); return dateToKey(d); };
const getWeekKeys   = (mk)  => Array.from({length:6},(_,i)=>offsetDate(mk,i));
const isToday       = (k)   => k===todayKey();
const randColor     = ()    => JOB_COLORS[Math.floor(Math.random()*JOB_COLORS.length)];
const fmtDT         = (ts)  => new Date(ts).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const fmtDateFR     = (k)   => { const d=new Date(k+"T12:00:00"); return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`; };
const fmtShortFR    = (k)   => { const d=new Date(k+"T12:00:00"); return `${DAYS_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`; };

// ─── Horaires helpers ──────────────────────────────────────────────────────────
const getWH = (dk, wh) => { const idx=getDayIdx(dk); return {...(DEFAULT_WH[idx]||{start:8,end:18,active:false}), ...(wh[idx]||{})}; };
const isWorkingDay = (dk, wh) => { const w=getWH(dk,wh); return w && w.active!==false; };
const nextWorkingDay = (dk, wh) => {
  let d=offsetDate(dk,1); let s=0;
  while(s++<14){ if(isWorkingDay(d,wh))return d; d=offsetDate(d,1); }
  return d;
};

// ─── Calcul date/heure de fin (respecte jours non travaillés) ─────────────────
function computeEnd(startDate, startTime, durationMin, wh) {
  if(durationMin<=0) return {endDate:startDate,endTime:startTime};
  let rem=durationMin, curDate=startDate, curMin=timeToMin(startTime), safety=0;
  while(rem>0 && safety++<90){
    const w=getWH(curDate,wh);
    // Jour non travaillé (sauf si c'est le jour de début)
    if(curDate!==startDate && w.active===false){
      curDate=nextWorkingDay(curDate,wh);
      curMin=getWH(curDate,wh).start*60; continue;
    }
    const dayEnd=(w.end||18)*60;
    const avail=Math.max(0,dayEnd-curMin);
    if(avail===0){
      // Fin de journée dépassée → jour suivant travaillé
      const nd=nextWorkingDay(curDate,wh);
      curDate=nd; curMin=getWH(nd,wh).start*60; continue;
    }
    if(rem<=avail){ return {endDate:curDate,endTime:minToTime(curMin+rem)}; }
    rem-=avail;
    const nd=nextWorkingDay(curDate,wh);
    curDate=nd; curMin=getWH(nd,wh).start*60;
  }
  return {endDate:curDate,endTime:minToTime(curMin)};
}

// ─── Calcul durée totale travaillée entre deux dates ──────────────────────────
function computeDuration(startDate,startTime,endDate,endTime,wh){
  let total=0,curDate=startDate,curMin=timeToMin(startTime),safety=0;
  while(curDate<=endDate && safety++<90){
    const w=getWH(curDate,wh);
    if(w.active===false){curDate=offsetDate(curDate,1);continue;}
    const dayEnd=(w.end||18)*60;
    const dayStart=(w.start||8)*60;
    const from=curDate===startDate?curMin:dayStart;
    const to  =curDate===endDate  ?timeToMin(endTime):dayEnd;
    total+=Math.max(0,to-from);
    curDate=offsetDate(curDate,1);
    curMin=dayStart;
  }
  return total;
}

// ─── Chevauchement d'une tâche avec un jour ───────────────────────────────────
const jobOverlapsDay = (j,dk) => j.startDate<=dk && j.endDate>=dk;

// ─── Segment visible d'une tâche pour un jour donné ──────────────────────────
function getSegment(job, dk, wh){
  const w=getWH(dk,wh);
  const dayStartMin=(w.start||8)*60, dayEndMin=(w.end||18)*60;
  const segStart = job.startDate===dk ? Math.max(timeToMin(job.startTime),dayStartMin) : dayStartMin;
  const segEnd   = job.endDate===dk   ? Math.min(timeToMin(job.endTime),  dayEndMin)   : dayEndMin;
  return { segStart, segEnd, before:job.startDate<dk, after:job.endDate>dk, duration:segEnd-segStart };
}

// ─── Nombre de jours travaillés ────────────────────────────────────────────────
function countWorkDays(startDate,endDate,wh){
  let n=0,d=startDate;
  while(d<=endDate){ if(isWorkingDay(d,wh))n++; d=offsetDate(d,1); }
  return n;
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [authUser,      setAuthUser]      = useState(undefined);
  const [userProfile,   setUserProfile]   = useState(null);
  const [allJobs,       setAllJobs]       = useState({});  // GLOBAL: tous les jobs
  const [workingHours,  setWorkingHours]  = useState(DEFAULT_WH);
  const [notifs,        setNotifs]        = useState({});
  const [allUsers,      setAllUsers]      = useState({});
  const [dateKey,       setDateKey]       = useState(todayKey());
  const [modal,         setModal]         = useState(null);
  const [form,          setForm]          = useState({});
  const [view,          setView]          = useState("planning");
  const [showNotifs,    setShowNotifs]    = useState(false);
  const [showAdmin,     setShowAdmin]     = useState(false);
  const [draggingJob,   setDraggingJob]   = useState(null);
  const [dragOverCell,  setDragOverCell]  = useState(null);
  const [loginErr,      setLoginErr]      = useState("");

  // ── Auth ──────────────────────────────────────────────────────────
  useEffect(()=>onAuthStateChanged(auth,(u)=>{
    setAuthUser(u||null);
    if(!u){setUserProfile(null);return;}
    onValue(ref(db,`users/${u.uid}`),(snap)=>{
      const d=snap.val();
      if(d)setUserProfile(d);
      else{ const p={email:u.email,name:u.email.split("@")[0],role:"operateur"}; update(ref(db,`users/${u.uid}`),p); setUserProfile(p); }
    });
  }),[]);

  // ── Horaires ──────────────────────────────────────────────────────
  useEffect(()=>{ if(!authUser)return; return onValue(ref(db,"settings/workingHours"),(snap)=>{ const d=snap.val(); if(d)setWorkingHours({...DEFAULT_WH,...d}); }); },[authUser]);

  // ── Jobs globaux ──────────────────────────────────────────────────
  useEffect(()=>{ if(!authUser)return; return onValue(ref(db,"jobs"),(snap)=>setAllJobs(snap.val()||{})); },[authUser]);

  // ── Notifs / Users ────────────────────────────────────────────────
  useEffect(()=>{ if(!authUser||userProfile?.role!=="admin")return; return onValue(ref(db,"notifications"),(snap)=>setNotifs(snap.val()||{})); },[authUser,userProfile?.role]);
  useEffect(()=>{ if(!authUser||userProfile?.role!=="admin")return; return onValue(ref(db,"users"),(snap)=>setAllUsers(snap.val()||{})); },[authUser,userProfile?.role]);

  const logChange=useCallback(async(action,details)=>{
    if(!authUser||!userProfile)return;
    await push(ref(db,"notifications"),{ts:Date.now(),action,details,user:userProfile.name||userProfile.email,role:userProfile.role,read:false});
  },[authUser,userProfile]);

  // ── Dérivés ───────────────────────────────────────────────────────
  const role = userProfile?.role||"lecteur";
  const can  = CAN[role]||CAN.lecteur;
  const jobsList = Object.entries(allJobs).map(([key,val])=>({...val,key}));
  const dayJobs  = jobsList.filter(j=>jobOverlapsDay(j,dateKey));
  const notifsList=Object.entries(notifs).map(([key,val])=>({...val,key})).sort((a,b)=>b.ts-a.ts);
  const unread   = notifsList.filter(n=>!n.read).length;
  const monoM    = MACHINES.filter(m=>m.type==="mono");
  const multiM   = MACHINES.filter(m=>m.type==="multi");

  // ── CRUD ──────────────────────────────────────────────────────────
  const openAdd=(machineId,startTime,dk=dateKey)=>{
    if(!can.add)return;
    const wh=getWH(dk,workingHours);
    const st=startTime||minToTime(wh.start*60);
    const {endDate,endTime}=computeEnd(dk,st,60,workingHours);
    setForm({machineId,startDate:dk,startTime:st,endDate,endTime,durationMin:60,durationDays:0,durationH:1,durationM:0,client:"",description:"",status:"En attente",couleur:randColor()});
    setModal({type:"add"});
  };
  const openEdit=(job)=>{ if(!can.edit&&!can.delete)return; const tot=job.durationMin||0; const days=Math.floor(tot/(8*60)),rem=tot%(8*60),hours=Math.floor(rem/60),mins=rem%60; setForm({...job,durationDays:days,durationH:hours,durationM:mins}); setModal({type:"edit"}); };

  // Recalcule la fin quand la durée change dans le formulaire
  const updateFormDuration=(patch)=>{
    setForm(f=>{
      const nf={...f,...patch};
      // total en minutes (1 jour = 8h par défaut)
      const totMin=(nf.durationDays||0)*8*60+(nf.durationH||0)*60+(nf.durationM||0);
      const{endDate,endTime}=computeEnd(nf.startDate,nf.startTime,Math.max(1,totMin),workingHours);
      return {...nf,durationMin:Math.max(1,totMin),endDate,endTime};
    });
  };
  // Recalcule quand startDate ou startTime change
  const updateFormStart=(patch)=>{
    setForm(f=>{
      const nf={...f,...patch};
      const totMin=nf.durationMin||60;
      const{endDate,endTime}=computeEnd(nf.startDate,nf.startTime,totMin,workingHours);
      return {...nf,endDate,endTime};
    });
  };

  const saveJob=async()=>{
    if(!form.client.trim())return;
    const{key,durationDays,durationH,durationM,...data}=form;
    const m=MACHINES.find(x=>x.id===data.machineId);
    const wd=countWorkDays(data.startDate,data.endDate,workingHours);
    const detail=`"${data.client}" sur ${m?.label}, ${fmtShortFR(data.startDate)} ${fmtTime(data.startTime)} → ${fmtShortFR(data.endDate)} ${fmtTime(data.endTime)} (${wd} jour${wd>1?"s":""} travaillé${wd>1?"s":""})`;
    if(modal.type==="add"){ await push(ref(db,"jobs"),data); await logChange("ajout",`Ajout ${detail}`); }
    else { await update(ref(db,`jobs/${key}`),data); await logChange("modification",`Modif ${detail}`); }
    setModal(null);
  };
  const deleteJob=async(key,job)=>{
    if(!can.delete)return;
    const m=MACHINES.find(x=>x.id===job.machineId);
    await remove(ref(db,`jobs/${key}`));
    await logChange("suppression",`Suppression "${job.client}" de ${m?.label}`);
    setModal(null);
  };

  // ── Drag & drop ───────────────────────────────────────────────────
  const onDragStart=(job)=>{ if(!can.edit)return; setDraggingJob(job); };
  const onDragEnd  =()=>{ setDraggingJob(null); setDragOverCell(null); };
  const onDrop     =async(machineId,newStartTime,newStartDate)=>{
    if(!draggingJob||!can.edit)return;
    const job=draggingJob;
    const {endDate,endTime}=computeEnd(newStartDate,newStartTime,job.durationMin,workingHours);
    const fromM=MACHINES.find(x=>x.id===job.machineId), toM=MACHINES.find(x=>x.id===machineId);
    await update(ref(db,`jobs/${job.key}`),{machineId,startDate:newStartDate,startTime:newStartTime,endDate,endTime});
    await logChange("deplacement",`Déplacement "${job.client}" : ${fromM?.label} ${fmtShortFR(job.startDate)} ${fmtTime(job.startTime)} → ${toM?.label} ${fmtShortFR(newStartDate)} ${fmtTime(newStartTime)}`);
    setDraggingJob(null); setDragOverCell(null);
  };

  const markAllRead=async()=>{ const u={}; Object.keys(notifs).forEach(k=>{u[`notifications/${k}/read`]=true;}); await update(ref(db),u); };
  const deleteNotif=async(k)=>remove(ref(db,`notifications/${k}`));

  if(authUser===undefined)return<Loader/>;
  if(!authUser)return<LoginScreen error={loginErr} onLogin={async(e,p)=>{ try{setLoginErr("");await signInWithEmailAndPassword(auth,e,p);}catch{setLoginErr("Email ou mot de passe incorrect.");} }}/>;

  const wh   = getWH(dateKey,workingHours);
  const dayActive = wh.active!==false;
  const dragProps = {draggingJob,dragOverCell,setDragOverCell,onDragStart,onDragEnd,onDrop,can};

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
            {view==="semaine"?<div style={{color:"white",fontSize:11,fontWeight:600}}>Semaine du {fmtShortFR(getMondayKey(dateKey))}</div>
            :<><div style={{color:"white",fontSize:11,fontWeight:600}}>{fmtDateFR(dateKey)}</div>{isToday(dateKey)&&<div style={{fontSize:10,color:"#81B29A",fontWeight:600}}>Aujourd'hui</div>}</>}
          </div>
          <button onClick={()=>setDateKey(k=>offsetDate(k,view==="semaine"?7:1))} style={navBtn}>›</button>
          <button onClick={()=>setDateKey(todayKey())} style={{...navBtn,fontSize:10,width:"auto",padding:"0 8px"}}>Auj.</button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {[["planning","📅 Jour"],["semaine","📆 Semaine"],["recap","📊 Récap"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"#E07A5F":"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:7,padding:"6px 11px",fontWeight:600,cursor:"pointer",fontSize:11}}>{label}</button>
          ))}
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {role==="admin"&&<button onClick={()=>{setShowNotifs(v=>!v);setShowAdmin(false);}} style={{...iconBtn,position:"relative"}}>🔔{unread>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#E07A5F",color:"white",borderRadius:99,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}</button>}
          {role==="admin"&&<button onClick={()=>{setShowAdmin(v=>!v);setShowNotifs(false);}} style={iconBtn}>⚙️</button>}
          <button onClick={()=>signOut(auth)} style={{...iconBtn,opacity:0.7}}>🚪</button>
        </div>
      </div>

      {showNotifs&&role==="admin"&&<NotifPanel notifs={notifsList} onMarkRead={markAllRead} onDelete={deleteNotif} onClose={()=>setShowNotifs(false)}/>}
      {showAdmin &&role==="admin"&&<AdminPanel allUsers={allUsers} workingHours={workingHours} onClose={()=>setShowAdmin(false)}/>}

      {view==="planning"&&<PlanningView monoM={monoM} multiM={multiM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} dayActive={dayActive} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} {...dragProps}/>}
      {view==="semaine" &&<WeekView monoM={monoM} multiM={multiM} allJobs={jobsList} mondayKey={getMondayKey(dateKey)} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} onDayClick={(dk)=>{setDateKey(dk);setView("planning");}} {...dragProps}/>}
      {view==="recap"   &&<RecapView dayJobs={dayJobs} allJobs={jobsList} machines={MACHINES} dateKey={dateKey} workingHours={workingHours}/>}

      {/* ── Modal ── */}
      {modal&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:24,width:440,boxShadow:"0 20px 60px rgba(0,0,0,0.25)",maxHeight:"90vh",overflowY:"auto"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#1A1A2E"}}>{modal.type==="add"?"➕ Nouvelle commande":"✏️ Modifier"}</div>

            {[{label:"Client *",key:"client",ph:"Nom du client"},{label:"Description",key:"description",ph:"Ex: Polos x30"}].map(({label,key,ph})=>(
              <div key={key} style={{marginBottom:10}}>
                <label style={lbl}>{label}</label>
                <input value={form[key]||""} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph} style={inp}/>
              </div>
            ))}

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1}}><label style={lbl}>Machine</label>
                <select value={form.machineId||"M1"} onChange={e=>setForm(f=>({...f,machineId:e.target.value}))} style={sel}>{MACHINES.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}</select>
              </div>
              <div style={{flex:1}}><label style={lbl}>Statut</label>
                <select value={form.status||"En attente"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={sel}>{Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>
              </div>
            </div>

            {/* Début */}
            <div style={{background:"#F7F9FC",borderRadius:10,padding:"12px",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#4A5568",marginBottom:8}}>📅 Début</div>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}><label style={lbl}>Date</label>
                  <input type="date" value={form.startDate||todayKey()} onChange={e=>updateFormStart({startDate:e.target.value})} style={inp}/>
                </div>
                <div style={{flex:1}}><label style={lbl}>Heure</label>
                  <input type="time" value={form.startTime||"08:00"} onChange={e=>updateFormStart({startTime:e.target.value})} style={inp}/>
                </div>
              </div>
            </div>

            {/* Durée */}
            <div style={{background:"#F7F9FC",borderRadius:10,padding:"12px",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#4A5568",marginBottom:8}}>⏱ Durée de travail <span style={{fontWeight:400,color:"#A0AEC0"}}>(jours non travaillés automatiquement ignorés)</span></div>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <div style={{flex:1}}><label style={lbl}>Jours</label>
                  <select value={form.durationDays||0} onChange={e=>updateFormDuration({durationDays:+e.target.value})} style={sel}>
                    {Array.from({length:31},(_,i)=><option key={i} value={i}>{i}j</option>)}
                  </select>
                </div>
                <div style={{flex:1}}><label style={lbl}>Heures</label>
                  <select value={form.durationH||0} onChange={e=>updateFormDuration({durationH:+e.target.value})} style={sel}>
                    {Array.from({length:24},(_,i)=><option key={i} value={i}>{i}h</option>)}
                  </select>
                </div>
                <div style={{flex:1}}><label style={lbl}>Minutes</label>
                  <select value={form.durationM||0} onChange={e=>updateFormDuration({durationM:+e.target.value})} style={sel}>
                    {[0,5,10,15,20,25,30,35,40,45,50,55].map(m=><option key={m} value={m}>{String(m).padStart(2,"0")}min</option>)}
                  </select>
                </div>
              </div>
              <div style={{fontSize:11,color:"#718096"}}>Durée totale de travail : <strong>{fmtDur(form.durationMin||60)}</strong></div>
            </div>

            {/* Fin calculée */}
            {form.endDate&&(
              <div style={{background:form.startDate===form.endDate?"#F0FDF4":"#EBF4FF",border:`1.5px solid ${form.startDate===form.endDate?"#A3CFBB":"#93C5FD"}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#4A5568",fontWeight:600,marginBottom:2}}>
                  {form.startDate===form.endDate?"✅ Tâche sur une journée":"📆 Tâche multi-jours"}
                </div>
                <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E"}}>
                  Fin : {fmtDateFR(form.endDate)} à {fmtTime(form.endTime)}
                </div>
                {form.startDate!==form.endDate&&(
                  <div style={{fontSize:11,color:"#718096",marginTop:2}}>
                    {countWorkDays(form.startDate,form.endDate,workingHours)} jours travaillés · les jours non travaillés sont ignorés
                  </div>
                )}
              </div>
            )}

            <div style={{display:"flex",gap:8}}>
              {modal.type==="edit"&&can.delete&&<button onClick={()=>deleteJob(form.key,form)} style={{padding:"9px 13px",borderRadius:8,border:"none",background:"#FEE2E2",color:"#991B1B",fontWeight:600,cursor:"pointer"}}>🗑</button>}
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

// ─── Vue Jour ─────────────────────────────────────────────────────────────────
function PlanningView({monoM,multiM,dayJobs,dateKey,wh,dayActive,workingHours,openAdd,openEdit,...dragProps}){
  const byS=Object.keys(STATUS_COLORS).reduce((a,s)=>{a[s]=dayJobs.filter(j=>j.status===s).length;return a;},{});
  const multiDay=dayJobs.filter(j=>j.startDate!==j.endDate).length;
  return(
    <div style={{padding:"12px 10px"}}>
      {!dayActive&&<div style={{background:"#FFF3CD",border:"1px solid #FFDA6A",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#856404",fontWeight:600}}>⚠️ Ce jour est marqué comme non travaillé.</div>}
      <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {[{label:"Total",value:dayJobs.length,icon:"📋",bg:"#1A1A2E",color:"white"},
          ...Object.entries(byS).map(([s,n])=>({label:STATUS_LABELS[s],value:n,icon:s==="En cours"?"⚙️":s==="Urgent"?"🚨":s==="Termine"?"✅":"⏳",bg:STATUS_COLORS[s].bg,color:STATUS_COLORS[s].text})),
          ...(multiDay>0?[{label:"Multi-jours",value:multiDay,icon:"📆",bg:"#EBF4FF",color:"#1D4ED8"}]:[])
        ].map(({label,value,icon,bg,color})=>(
          <div key={label} style={{background:bg,color,borderRadius:9,padding:"6px 11px",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:11,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
            <span>{icon}</span><span style={{fontSize:14,fontWeight:800}}>{value}</span><span style={{opacity:0.8}}>{label}</span>
          </div>
        ))}
        {dragProps.can.edit&&<div style={{marginLeft:"auto",fontSize:11,color:"#A0AEC0",fontStyle:"italic"}}>✋ Glissez (snap 5min)</div>}
      </div>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <TimelineGrid label="🪡 Mono-Têtes" machines={monoM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" {...dragProps}/>
        <div style={{height:1,background:"#F0EDE8"}}/>
        <TimelineGrid label="🎛 Multi-Têtes" machines={multiM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" {...dragProps}/>
      </div>
      <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"#A0AEC0"}}>Clic = ajouter · Clic tâche = modifier · Glisser = déplacer · <span style={{color:"#6B9AC4"}}>◀ ▶ = tâche multi-jours</span></div>
    </div>
  );
}

// ─── Timeline pixel ────────────────────────────────────────────────────────────
function TimelineGrid({label,machines,dayJobs,dateKey,wh,workingHours,openAdd,openEdit,headerColor,draggingJob,dragOverCell,setDragOverCell,onDragStart,onDragEnd,onDrop,can}){
  const wrapRef=useRef(null);
  const [wrapW,setWrapW]=useState(0);
  useEffect(()=>{
    if(!wrapRef.current)return;
    const ro=new ResizeObserver(([e])=>setWrapW(e.contentRect.width));
    ro.observe(wrapRef.current); return()=>ro.disconnect();
  },[]);

  const dayStartMin=(wh.start||8)*60, dayEndMin=(wh.end||18)*60, dayDur=dayEndMin-dayStartMin;
  const tlW=wrapW>0?Math.max(wrapW-LABEL_W,MIN_TIMELINE):MIN_TIMELINE;
  const toLeft=(m)=>((m-dayStartMin)/dayDur)*tlW;
  const toWidth=(d)=>(d/dayDur)*tlW;
  const isDragging=draggingJob!=null;

  const hourMarkers=[]; for(let m=dayStartMin;m<=dayEndMin;m+=60)hourMarkers.push(m);
  const halfMarkers=[]; for(let m=dayStartMin+30;m<dayEndMin;m+=60)halfMarkers.push(m);

  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div ref={wrapRef} style={{overflowX:tlW<=wrapW-LABEL_W||wrapW===0?"hidden":"auto"}}>
        <div style={{display:"flex",width:LABEL_W+tlW}}>

          {/* Labels */}
          <div style={{width:LABEL_W,flexShrink:0,borderRight:"1px solid #F0EDE8"}}>
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
          <div style={{position:"relative",width:tlW,flexShrink:0}}>
            {/* En-têtes heures */}
            <div style={{height:28,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"relative"}}>
              {hourMarkers.map(m=>(
                <div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:m===dayStartMin?"none":"1px solid #E2E8F0",display:"flex",alignItems:"center",paddingLeft:4}}>
                  <span style={{fontSize:10,fontWeight:600,color:"#718096",whiteSpace:"nowrap"}}>{fmtTime(minToTime(m))}</span>
                </div>
              ))}
            </div>

            {/* Rangées machines */}
            {machines.map((machine,mi)=>{
              const mJobs=dayJobs.filter(j=>j.machineId===machine.id);
              const isOver=dragOverCell?.machineId===machine.id&&dragOverCell?.dk===dateKey;
              return(
                <div key={machine.id}
                  style={{height:ROW_H,position:"relative",background:isOver?(mi%2===0?"#EBF4FF":"#E6F0FF"):(mi%2===0?"white":"#FDFCFB"),borderBottom:"1px solid #F7F4F0",transition:"background .1s"}}
                  onDragOver={e=>{ e.preventDefault(); if(can.edit)setDragOverCell({machineId:machine.id,dk:dateKey}); }}
                  onDragLeave={()=>setDragOverCell(null)}
                  onDrop={e=>{
                    e.preventDefault(); if(!draggingJob||!can.edit)return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const rawMin=dayStartMin+((e.clientX-rect.left)/tlW)*dayDur;
                    const snapped=Math.max(dayStartMin,Math.min(dayEndMin-5,snapMin(rawMin)));
                    onDrop(machine.id,minToTime(snapped),dateKey);
                  }}
                  onClick={e=>{
                    if(isDragging||!can.add)return;
                    const rect=e.currentTarget.getBoundingClientRect();
                    const rawMin=dayStartMin+((e.clientX-rect.left)/tlW)*dayDur;
                    const snapped=Math.max(dayStartMin,Math.min(dayEndMin-5,snapMin(rawMin)));
                    openAdd(machine.id,minToTime(snapped),dateKey);
                  }}
                >
                  {halfMarkers.map(m=><div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:"1px dashed #F0EDE8",pointerEvents:"none"}}/>)}
                  {hourMarkers.filter(m=>m>dayStartMin).map(m=><div key={m} style={{position:"absolute",left:toLeft(m),top:0,bottom:0,borderLeft:"1px solid #E8E8E8",pointerEvents:"none"}}/>)}

                  {mJobs.map(job=>{
                    const seg=getSegment(job,dateKey,workingHours);
                    const left =toLeft(seg.segStart);
                    const width=Math.max(toWidth(seg.duration),12);
                    const sc   =STATUS_COLORS[job.status];
                    const isGhost=draggingJob?.key===job.key;
                    const isMulti=job.startDate!==job.endDate;
                    return(
                      <div key={job.key}
                        draggable={can.edit}
                        onDragStart={e=>{ e.stopPropagation(); onDragStart(job); }}
                        onDragEnd={onDragEnd}
                        onClick={e=>{ e.stopPropagation(); if(!isDragging)openEdit(job); }}
                        title={`${job.client}${job.description?" – "+job.description:""}\n${fmtDateFR(job.startDate)} ${fmtTime(job.startTime)} → ${fmtDateFR(job.endDate)} ${fmtTime(job.endTime)}\nDurée : ${fmtDur(job.durationMin)}`}
                        style={{
                          position:"absolute", left, width:width-2, top:5, bottom:5,
                          background:sc.bg, border:`1.5px solid ${sc.border}`,
                          borderLeft:seg.before?"3px dashed "+job.couleur:`3px solid ${job.couleur}`,
                          borderRight:seg.after?"2px dashed "+sc.border:`1.5px solid ${sc.border}`,
                          borderRadius:`${seg.before?0:6}px ${seg.after?0:6}px ${seg.after?0:6}px ${seg.before?0:6}px`,
                          padding:"3px 5px", overflow:"hidden",
                          cursor:can.edit?(isDragging?"grabbing":"grab"):"pointer",
                          opacity:isGhost?0.25:1, transition:"opacity .15s,box-shadow .1s", userSelect:"none", zIndex:1,
                        }}
                        onMouseEnter={e=>{ if(!isDragging&&can.edit)e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.18)"; e.currentTarget.style.zIndex=10; }}
                        onMouseLeave={e=>{ e.currentTarget.style.boxShadow="none"; e.currentTarget.style.zIndex=1; }}
                      >
                        {/* Indicateurs continuation */}
                        {seg.before&&<span style={{fontSize:9,color:job.couleur,fontWeight:900,marginRight:2}}>◀</span>}
                        <span style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                          {job.client}
                          {isMulti&&<span style={{fontSize:9,background:job.couleur,color:"white",borderRadius:3,padding:"0 3px",marginLeft:3}}>multi</span>}
                        </span>
                        {seg.after&&<span style={{fontSize:9,color:job.couleur,fontWeight:900,position:"absolute",right:3,top:"50%",transform:"translateY(-50%)"}}>▶</span>}
                        {width>80&&<div style={{fontSize:10,color:sc.text,opacity:0.55,whiteSpace:"nowrap"}}>
                          {seg.before?"↳ ":" "}{fmtTime(minToTime(seg.segStart))}→{fmtTime(minToTime(seg.segEnd))}{seg.after?" ↦":""}
                        </div>}
                      </div>
                    );
                  })}
                  {isOver&&<div style={{position:"absolute",inset:0,border:"2px dashed #6B9AC4",borderRadius:4,pointerEvents:"none",display:"flex",alignItems:"center",justifyContent:"center"}}><span style={{fontSize:11,fontWeight:700,color:"#6B9AC4"}}>Déposer ici</span></div>}
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
function WeekView({monoM,multiM,allJobs,mondayKey,workingHours,openAdd,openEdit,onDayClick,...dragProps}){
  const weekKeys  =getWeekKeys(mondayKey);
  const activeDays=weekKeys.filter(k=>isWorkingDay(k,workingHours));
  return(
    <div style={{padding:"12px 10px"}}>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <WeekGrid label="🪡 Mono-Têtes" machines={monoM} allJobs={allJobs} weekKeys={activeDays} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" onDayClick={onDayClick} {...dragProps}/>
        <div style={{height:1,background:"#F0EDE8"}}/>
        <WeekGrid label="🎛 Multi-Têtes" machines={multiM} allJobs={allJobs} weekKeys={activeDays} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" onDayClick={onDayClick} {...dragProps}/>
      </div>
      <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"#A0AEC0"}}>Clic sur un jour = vue détaillée · <span style={{color:"#6B9AC4"}}>◀▶ = tâche multi-jours</span> · Glisser entre jours</div>
    </div>
  );
}

function WeekGrid({label,machines,allJobs,weekKeys,workingHours,openAdd,openEdit,headerColor,onDayClick,draggingJob,setDragOverCell,onDragStart,onDragEnd,onDrop,can}){
  const isDragging=draggingJob!=null;
  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
          <thead><tr>
            <th style={{width:88,padding:"8px 11px",textAlign:"left",fontSize:11,color:"#718096",fontWeight:600,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"sticky",left:0,zIndex:2}}>Machine</th>
            {weekKeys.map(dk=>(
              <th key={dk} onClick={()=>onDayClick(dk)} style={{padding:"8px 6px",fontSize:11,color:isToday(dk)?"#E07A5F":"#718096",fontWeight:isToday(dk)?800:600,background:isToday(dk)?"#FFF5F3":"#FAFAF8",borderBottom:"1px solid #F0EDE8",textAlign:"center",cursor:"pointer",borderLeft:"1px solid #F0EDE8",minWidth:110}}>
                <div>{DAYS_FR[getDayIdx(dk)]}</div>
                <div style={{fontSize:10,fontWeight:400,color:isToday(dk)?"#E07A5F":"#A0AEC0"}}>{fmtShortFR(dk)}</div>
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
                  const wh=getWH(dk,workingHours);
                  const dayJobsList=allJobs.filter(j=>j.machineId===machine.id&&jobOverlapsDay(j,dk));
                  return(
                    <td key={dk}
                      onClick={()=>{ if(!isDragging&&can.add)openAdd(machine.id,minToTime(wh.start*60),dk); }}
                      onDragOver={e=>{ e.preventDefault(); if(can.edit)setDragOverCell({machineId:machine.id,dk}); }}
                      onDragLeave={()=>setDragOverCell(null)}
                      onDrop={e=>{ e.preventDefault(); if(draggingJob&&can.edit)onDrop(machine.id,draggingJob.startTime,dk); }}
                      style={{padding:5,verticalAlign:"top",borderBottom:"1px solid #F7F4F0",borderLeft:"1px solid #F0EDE8",minWidth:110,minHeight:60,cursor:isDragging&&can.edit?"copy":can.add?"cell":"default",background:isToday(dk)?"#FDFCFA":"transparent"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:3,minHeight:54}}>
                        {dayJobsList.sort((a,b)=>timeToMin(a.startTime)-timeToMin(b.startTime)).map(job=>{
                          const sc=STATUS_COLORS[job.status];
                          const seg=getSegment(job,dk,workingHours);
                          const isMulti=job.startDate!==job.endDate;
                          return(
                            <div key={job.key} draggable={can.edit}
                              onDragStart={e=>{e.stopPropagation();onDragStart(job);}}
                              onDragEnd={onDragEnd}
                              onClick={e=>{e.stopPropagation();if(!isDragging)openEdit(job);}}
                              style={{background:sc.bg,border:`1.5px solid ${sc.border}`,
                                borderLeft:seg.before?`3px dashed ${job.couleur}`:`3px solid ${job.couleur}`,
                                borderRadius:6,padding:"3px 6px",cursor:can.edit?"grab":"default",userSelect:"none",position:"relative"}}
                              onMouseEnter={e=>{if(can.edit)e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.12)";}}
                              onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
                              <div style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {seg.before&&<span style={{fontSize:9,color:job.couleur,fontWeight:900,marginRight:2}}>◀</span>}
                                {job.client}
                                {seg.after&&<span style={{fontSize:9,color:job.couleur,fontWeight:900,marginLeft:2}}>▶</span>}
                                {isMulti&&<span style={{fontSize:9,background:job.couleur,color:"white",borderRadius:3,padding:"0 3px",marginLeft:3}}>multi</span>}
                              </div>
                              <div style={{fontSize:10,color:sc.text,opacity:0.6}}>
                                {seg.before?`↳ jusqu'à ${fmtTime(minToTime(seg.segEnd))}`:fmtTime(job.startTime)}
                                {!seg.before&&(seg.after?` ↦`:`→${fmtTime(job.endTime)}`)}
                              </div>
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

// ─── Récap ─────────────────────────────────────────────────────────────────────
function RecapView({dayJobs,allJobs,machines,dateKey,workingHours}){
  const stats=machines.map(m=>{const mj=dayJobs.filter(j=>j.machineId===m.id);return{...m,mj,totalMin:mj.reduce((a,j)=>{const s=getSegment(j,dateKey,workingHours);return a+s.duration;},0)};});
  const maxM=Math.max(...stats.map(m=>m.totalMin),1);
  const inProgress=allJobs.filter(j=>j.status==="En cours"||j.status==="Urgent");
  return(
    <div style={{padding:"12px 10px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#1A1A2E",marginBottom:12}}>📊 Récap — {fmtDateFR(dateKey)}</div>
      <div style={{background:"white",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#4A5568",marginBottom:10}}>Charge par machine ce jour</div>
        {stats.map(m=>(
          <div key={m.id} style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
              <span style={{fontWeight:600,color:"#2D3748"}}>{m.label}</span>
              <span style={{color:"#718096"}}>{fmtDur(m.totalMin)} · {m.mj.length} commande{m.mj.length!==1?"s":""}</span>
            </div>
            <div style={{height:7,background:"#F0EDE8",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min((m.totalMin/maxM)*100,100)}%`,background:m.color,borderRadius:99}}/></div>
          </div>
        ))}
      </div>
      {inProgress.length>0&&(
        <div style={{background:"#FFF5F5",border:"1.5px solid #FEB2B2",borderRadius:14,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#C53030",marginBottom:6}}>🚨 En cours / Urgents (tous les jours)</div>
          {inProgress.map(job=>{const m=machines.find(m=>m.id===job.machineId);const wd=countWorkDays(job.startDate,job.endDate,workingHours);return<div key={job.key} style={{fontSize:12,color:"#742A2A",marginBottom:3}}><strong>{job.client}</strong> — {m?.label} · {fmtDateFR(job.startDate)} {fmtTime(job.startTime)} → {fmtDateFR(job.endDate)} {fmtTime(job.endTime)} <span style={{color:"#A0AEC0"}}>({wd}j travaillé{wd>1?"s":""})</span></div>;})}
        </div>
      )}
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{padding:"10px 14px",background:"#1A1A2E",color:"white",fontWeight:700,fontSize:12}}>Commandes du jour ({dayJobs.length})</div>
        {dayJobs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune commande ce jour</div>:(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#FAFAF8"}}>{["Client","Machine","Début","Fin","Durée","Statut"].map(h=><th key={h} style={{padding:"7px 10px",fontSize:11,color:"#718096",fontWeight:600,textAlign:"left",borderBottom:"1px solid #F0EDE8"}}>{h}</th>)}</tr></thead>
            <tbody>{dayJobs.sort((a,b)=>a.startDate.localeCompare(b.startDate)||timeToMin(a.startTime)-timeToMin(b.startTime)).map((job,i)=>{
              const m=machines.find(m=>m.id===job.machineId),sc=STATUS_COLORS[job.status];
              const wd=countWorkDays(job.startDate,job.endDate,workingHours);
              return<tr key={job.key} style={{background:i%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"7px 10px",fontWeight:600,fontSize:12,borderBottom:"1px solid #F7F4F0"}}>{job.client}{job.startDate!==job.endDate&&<span style={{fontSize:9,background:"#EBF4FF",color:"#1D4ED8",borderRadius:3,padding:"0 3px",marginLeft:4}}>multi</span>}</td>
                <td style={{padding:"7px 10px",fontSize:11,borderBottom:"1px solid #F7F4F0"}}><span style={{background:m?.color+"20",color:m?.color,padding:"2px 6px",borderRadius:5,fontWeight:600,fontSize:10}}>{m?.label}</span></td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0"}}><div style={{fontWeight:600}}>{fmtTime(job.startTime)}</div><div style={{fontSize:10,color:"#A0AEC0"}}>{job.startDate!==dateKey&&fmtShortFR(job.startDate)}</div></td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0"}}><div style={{fontWeight:600}}>{fmtTime(job.endTime)}</div><div style={{fontSize:10,color:"#A0AEC0"}}>{job.endDate!==dateKey&&fmtShortFR(job.endDate)}</div></td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{fmtDur(job.durationMin)}{wd>1&&<div style={{fontSize:10,color:"#6B9AC4"}}>{wd} jours</div>}</td>
                <td style={{padding:"7px 10px",borderBottom:"1px solid #F7F4F0"}}><span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,padding:"2px 6px",borderRadius:5,fontSize:10,fontWeight:600}}>{STATUS_LABELS[job.status]}</span></td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Admin ─────────────────────────────────────────────────────────────────────
function AdminPanel({allUsers,workingHours,onClose}){
  const [tab,setTab]=useState("users");
  const DN={0:"Dimanche",1:"Lundi",2:"Mardi",3:"Mercredi",4:"Jeudi",5:"Vendredi",6:"Samedi"};
  const AH=Array.from({length:15},(_,i)=>i+5);
  const saveH=async(d,f,v)=>await update(ref(db,`settings/workingHours/${d}`),{[f]:v});
  return(
    <div style={{position:"fixed",top:62,right:12,width:420,background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,overflow:"hidden",maxHeight:"82vh",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"11px 14px",background:"#3D405B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>⚙️ Administration</span>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
      </div>
      <div style={{display:"flex",borderBottom:"1px solid #F0EDE8"}}>
        {[["users","👥 Utilisateurs"],["horaires","🕐 Horaires"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"10px",border:"none",background:tab===t?"white":"#FAFAF8",fontWeight:tab===t?700:400,fontSize:12,cursor:"pointer",color:tab===t?"#1A1A2E":"#718096",borderBottom:tab===t?"2px solid #E07A5F":"2px solid transparent"}}>{l}</button>
        ))}
      </div>
      <div style={{overflowY:"auto",flex:1,padding:14}}>
        {tab==="users"&&(
          <>
            <div style={{fontSize:11,color:"#718096",marginBottom:10,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}><strong>Admin</strong> : tout + notifs · <strong>Opérateur</strong> : ajouter/modifier · <strong>Lecteur</strong> : consulter</div>
            {Object.entries(allUsers).map(([uid,u])=>(
              <div key={uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #F7F4F0"}}>
                <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,fontWeight:600,color:"#2D3748",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||u.email}</div><div style={{fontSize:10,color:"#A0AEC0"}}>{u.email}</div></div>
                <select value={u.role||"lecteur"} onChange={e=>update(ref(db,`users/${uid}`),{role:e.target.value})} style={{padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,cursor:"pointer",fontWeight:600,background:u.role==="admin"?"#FEFCE8":u.role==="operateur"?"#F0FDF4":"#F9FAFB",color:u.role==="admin"?"#854D0E":u.role==="operateur"?"#166534":"#4B5563"}}>
                  <option value="admin">Administrateur</option><option value="operateur">Opérateur</option><option value="lecteur">Lecteur</option>
                </select>
              </div>
            ))}
          </>
        )}
        {tab==="horaires"&&(
          <>
            <div style={{fontSize:11,color:"#718096",marginBottom:12,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}>Définissez les horaires par jour. Ces horaires sont utilisés pour calculer les dates de fin des tâches multi-jours.</div>
            {[1,2,3,4,5,6,0].map(di=>{
              const wh={...DEFAULT_WH[di],...(workingHours[di]||{})};
              return(
                <div key={di} style={{marginBottom:10,padding:"10px 12px",background:wh.active?"white":"#F7F4F0",borderRadius:10,border:`1.5px solid ${wh.active?"#E2E8F0":"#EDE8E3"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:wh.active?10:0}}>
                    <div style={{flex:1,fontWeight:700,fontSize:13,color:wh.active?"#1A1A2E":"#A0AEC0"}}>{DN[di]}</div>
                    <div onClick={()=>saveH(di,"active",!wh.active)} style={{width:38,height:20,borderRadius:99,background:wh.active?"#22C55E":"#CBD5E0",cursor:"pointer",position:"relative",transition:"background .2s"}}>
                      <div style={{position:"absolute",top:2,left:wh.active?20:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                    </div>
                    <span style={{fontSize:11,color:wh.active?"#22C55E":"#A0AEC0",fontWeight:600,minWidth:55}}>{wh.active?"Travaillé":"Repos"}</span>
                  </div>
                  {wh.active&&<div style={{display:"flex",gap:10,alignItems:"center"}}>
                    <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Début</label><select value={wh.start} onChange={e=>saveH(di,"start",+e.target.value)} style={{...sel,fontSize:12}}>{AH.filter(h=>h<wh.end).map(h=><option key={h} value={h}>{h}h00</option>)}</select></div>
                    <div style={{color:"#A0AEC0",fontSize:16,marginTop:14}}>→</div>
                    <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Fin</label><select value={wh.end} onChange={e=>saveH(di,"end",+e.target.value)} style={{...sel,fontSize:12}}>{AH.filter(h=>h>wh.start).map(h=><option key={h} value={h}>{h}h00</option>)}</select></div>
                    <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Total</label><div style={{padding:"7px 9px",borderRadius:8,background:"#F7F4F0",fontSize:12,color:"#4A5568",fontWeight:700,textAlign:"center"}}>{wh.end-wh.start}h</div></div>
                  </div>}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

function NotifPanel({notifs,onMarkRead,onDelete,onClose}){
  return(
    <div style={{position:"fixed",top:62,right:12,width:370,maxHeight:"70vh",background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 14px",background:"#1A1A2E",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>🔔 Modifications</span>
        <div style={{display:"flex",gap:7}}><button onClick={onMarkRead} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11}}>Tout lire</button><button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button></div>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {notifs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune notification</div>
        :notifs.map(n=>{
          const icon=n.action==="ajout"?"➕":n.action==="suppression"?"🗑":n.action==="deplacement"?"↔️":"✏️";
          return(
            <div key={n.key} style={{padding:"9px 13px",borderBottom:"1px solid #F7F4F0",background:n.read?"white":"#EBF4FF",display:"flex",gap:9,alignItems:"flex-start"}}>
              <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:"#2D3748",lineHeight:1.4}}>{n.details}</div><div style={{fontSize:10,color:"#A0AEC0",marginTop:2}}>{ROLE_LABELS[n.role]||n.role} <strong>{n.user}</strong> · {fmtDT(n.ts)}</div></div>
              {!n.read&&<div style={{width:7,height:7,borderRadius:"50%",background:"#E07A5F",flexShrink:0,marginTop:4}}/>}
              <button onClick={()=>onDelete(n.key)} style={{background:"none",border:"none",cursor:"pointer",color:"#CBD5E0",fontSize:13,flexShrink:0}}>×</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LoginScreen({onLogin,error}){
  const[e,setE]=useState("");const[p,setP]=useState("");
  return(
    <div style={{minHeight:"100vh",background:"#F7F4F0",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:20,padding:36,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        <div style={{textAlign:"center",marginBottom:22}}><div style={{fontSize:38}}>🧵</div><div style={{fontSize:20,fontWeight:800,color:"#1A1A2E",marginTop:6}}>PlanBrod</div></div>
        {error&&<div style={{background:"#FEE2E2",color:"#991B1B",borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:12,textAlign:"center"}}>{error}</div>}
        <div style={{marginBottom:11}}><label style={lbl}>Email</label><input type="email" value={e} onChange={x=>setE(x.target.value)} placeholder="votre@email.com" style={inp}/></div>
        <div style={{marginBottom:18}}><label style={lbl}>Mot de passe</label><input type="password" value={p} onChange={x=>setP(x.target.value)} placeholder="••••••••" onKeyDown={x=>x.key==="Enter"&&onLogin(e,p)} style={inp}/></div>
        <button onClick={()=>onLogin(e,p)} style={{width:"100%",padding:"10px",borderRadius:9,border:"none",background:"#1A1A2E",color:"white",fontWeight:700,cursor:"pointer",fontSize:13}}>Se connecter</button>
      </div>
    </div>
  );
}
function Loader(){return<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:13,color:"#718096",background:"#F7F4F0"}}>⏳ Chargement…</div>;}

const navBtn={background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:15,fontWeight:700};
const iconBtn={background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:7,width:30,height:30,cursor:"pointer",fontSize:15,position:"relative"};
const lbl={fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3};
const inp={width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"};
const sel={width:"100%",padding:"7px 9px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:12};
