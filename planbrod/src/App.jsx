import { useState, useEffect, useCallback, useRef } from "react";
import { db, auth } from "./firebase.js";
import { ref, onValue, push, remove, update, set } from "firebase/database";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged } from "firebase/auth";

// ─── Machines par défaut ───────────────────────────────────────────────────────
const DEFAULT_MACHINES = [
  { id:"M1", label:"Mono #1",  type:"mono",  color:"#E07A5F", heads:1,  active:true },
  { id:"M2", label:"Mono #2",  type:"mono",  color:"#E07A5F", heads:1,  active:true },
  { id:"M3", label:"Mono #3",  type:"mono",  color:"#E07A5F", heads:1,  active:true },
  { id:"M4", label:"Mono #4",  type:"mono",  color:"#E07A5F", heads:1,  active:true },
  { id:"T1", label:"Multi #1", type:"multi", color:"#3D405B", heads:6,  active:true },
  { id:"T2", label:"Multi #2", type:"multi", color:"#3D405B", heads:6,  active:true },
  { id:"T3", label:"Multi #3", type:"multi", color:"#3D405B", heads:6,  active:true },
];
const MACHINE_COLORS = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6B9AC4","#D4A5A5","#9BB7D4","#C3B1E1","#A8D5BA","#F4A261","#E76F51","#264653","#2A9D8F","#E9C46A","#A8DADC"];

// ─── Constantes ────────────────────────────────────────────────────────────────
const DAYS_FR    = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const DAYS_SHORT = ["Dim","Lun","Mar","Mer","Jeu","Ven","Sam"];
const MONTHS_FR  = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
const DEFAULT_WH = { 0:{start:8,end:18,active:false,breakActive:false,breakStart:720,breakEnd:780},1:{start:8,end:18,active:true,breakActive:false,breakStart:720,breakEnd:780},2:{start:8,end:18,active:true,breakActive:false,breakStart:720,breakEnd:780},3:{start:8,end:18,active:true,breakActive:false,breakStart:720,breakEnd:780},4:{start:8,end:18,active:true,breakActive:false,breakStart:720,breakEnd:780},5:{start:8,end:18,active:true,breakActive:false,breakStart:720,breakEnd:780},6:{start:8,end:13,active:false,breakActive:false,breakStart:720,breakEnd:780} };
const STATUS_COLORS = { "En attente":{bg:"#FFF3CD",text:"#856404",border:"#FFDA6A"},"En cours":{bg:"#D1E7DD",text:"#0F5132",border:"#A3CFBB"},"Termine":{bg:"#E2E3E5",text:"#41464B",border:"#BCBEBF"},"Urgent":{bg:"#F8D7DA",text:"#842029",border:"#F1AEB5"} };
const STATUS_LABELS = {"En attente":"En attente","En cours":"En cours","Termine":"Terminé","Urgent":"Urgent"};
const JOB_COLORS    = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6B9AC4","#D4A5A5","#9BB7D4","#C3B1E1","#A8D5BA","#F4A261"];
const ROLE_LABELS   = {admin:"Administrateur",operateur:"Opérateur",lecteur:"Lecteur"};
const CAN = { admin:{add:true,edit:true,delete:true,manage:true,status:true}, operateur:{add:true,edit:true,delete:false,manage:false,status:true}, lecteur:{add:false,edit:false,delete:false,manage:false,status:true} };
const SNAP_MIN=5, MIN_TIMELINE=320, LABEL_W=110, ROW_H=82;

// ─── Helpers temps ─────────────────────────────────────────────────────────────
const timeToMin = (t)=>{if(!t)return 0;const[h,m]=t.split(":").map(Number);return h*60+(m||0);};
const minToTime = (m)=>`${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).padStart(2,"0")}`;
const snapMin   = (m)=>Math.round(m/SNAP_MIN)*SNAP_MIN;
const fmtTime   = (t)=>{if(!t)return"";const[h,m]=t.split(":").map(Number);return m===0?`${h}h`:`${h}h${String(m).padStart(2,"0")}`;};
const fmtDur    = (m)=>{if(!m)return"0min";const h=Math.floor(m/60),r=m%60;return h>0?(r>0?`${h}h${String(r).padStart(2,"0")}`:`${h}h`):`${r}min`;};

// ─── Helpers date ──────────────────────────────────────────────────────────────
const dateToKey   =(d)=>d.toISOString().slice(0,10);
const todayKey    =()=>dateToKey(new Date());
const offsetDate  =(k,n)=>{const d=new Date(k+"T12:00:00");d.setDate(d.getDate()+n);return dateToKey(d);};
const getDayIdx   =(k)=>new Date(k+"T12:00:00").getDay();
const getMondayKey=(k)=>{const d=new Date(k+"T12:00:00"),dy=d.getDay(),df=d.getDate()-dy+(dy===0?-6:1);d.setDate(df);return dateToKey(d);};
const getWeekKeys =(mk)=>Array.from({length:6},(_,i)=>offsetDate(mk,i));
const isToday     =(k)=>k===todayKey();
const randColor   =()=>JOB_COLORS[Math.floor(Math.random()*JOB_COLORS.length)];
const fmtDT       =(ts)=>new Date(ts).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
const fmtDateFR   =(k)=>{const d=new Date(k+"T12:00:00");return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]}`;};
const fmtShortFR  =(k)=>{const d=new Date(k+"T12:00:00");return `${DAYS_SHORT[d.getDay()]} ${d.getDate()}/${d.getMonth()+1}`;};

// ─── Helpers horaires ──────────────────────────────────────────────────────────
const getWH         =(dk,wh)=>{const idx=getDayIdx(dk);return{...(DEFAULT_WH[idx]||{start:8,end:18,active:false}),...(wh[idx]||{})};};
const isWorkingDay  =(dk,wh)=>getWH(dk,wh).active!==false;
const nextWorkingDay=(dk,wh)=>{let d=offsetDate(dk,1),s=0;while(s++<14){if(isWorkingDay(d,wh))return d;d=offsetDate(d,1);}return d;};

// ─── Périodes de travail (matin + après-midi si pause) ───────────────────────
function getDayPeriods(dk,wh){
  const w=getWH(dk,wh);
  if(!w.active)return[];
  const s=w.start*60,e=w.end*60;
  if(w.breakActive&&w.breakStart>s&&w.breakEnd<e&&w.breakEnd>w.breakStart)
    return[{start:s,end:w.breakStart},{start:w.breakEnd,end:e}];
  return[{start:s,end:e}];
}
// Durée travaillée réelle d'un segment (exclut la pause)
function getWorkingDuration(segStart,segEnd,w){
  if(!w.breakActive||!w.breakStart||!w.breakEnd)return Math.max(0,segEnd-segStart);
  const ov=Math.max(0,Math.min(segEnd,w.breakEnd)-Math.max(segStart,w.breakStart));
  return Math.max(0,segEnd-segStart-ov);
}

// ─── Calcul date/heure de fin (pause méridienne prise en compte) ──────────────
function computeEnd(startDate,startTime,durationMin,wh){
  if(durationMin<=0)return{endDate:startDate,endTime:startTime};
  let rem=durationMin,curDate=startDate,curMin=timeToMin(startTime),safety=0;
  while(rem>0&&safety++<120){
    if(curDate!==startDate&&!isWorkingDay(curDate,wh)){
      curDate=nextWorkingDay(curDate,wh);
      curMin=getDayPeriods(curDate,wh)[0]?.start||getWH(curDate,wh).start*60;
      continue;
    }
    const periods=getDayPeriods(curDate,wh);
    // Trouver la première période qui n'est pas encore terminée
    const period=periods.find(p=>p.end>curMin);
    if(!period){
      curDate=nextWorkingDay(curDate,wh);
      curMin=getDayPeriods(curDate,wh)[0]?.start||getWH(curDate,wh).start*60;
      continue;
    }
    if(curMin<period.start)curMin=period.start; // Snap au début de la période (après la pause)
    const avail=period.end-curMin;
    if(rem<=avail)return{endDate:curDate,endTime:minToTime(curMin+rem)};
    rem-=avail;
    curMin=period.end; // Ira chercher la période suivante (ou lendemain)
  }
  return{endDate:curDate,endTime:minToTime(curMin)};
}
const jobOverlapsDay=(j,dk)=>j.startDate<=dk&&j.endDate>=dk;
function getSegment(job,dk,wh){
  const w=getWH(dk,wh),dayStartMin=(w.start||8)*60,dayEndMin=(w.end||18)*60;
  const segStart=job.startDate===dk?Math.max(timeToMin(job.startTime),dayStartMin):dayStartMin;
  const segEnd  =job.endDate===dk  ?Math.min(timeToMin(job.endTime),  dayEndMin)  :dayEndMin;
  const duration=getWorkingDuration(segStart,segEnd,w);
  return{segStart,segEnd,before:job.startDate<dk,after:job.endDate>dk,duration};
}
function countWorkDays(startDate,endDate,wh){let n=0,d=startDate;while(d<=endDate){if(isWorkingDay(d,wh))n++;d=offsetDate(d,1);}return n;}

// ─── Taux de remplissage ───────────────────────────────────────────────────────
// ─── Taux de remplissage enrichi ──────────────────────────────────────────────
function computeFillInfo(dk,allJobs,machines,wh){
  const active=machines.filter(m=>m.active!==false);
  if(!active.length)return null;
  const w=getWH(dk,wh); if(!w.active)return null;
  const breakDur=(w.breakActive&&w.breakStart&&w.breakEnd)?Math.max(0,w.breakEnd-w.breakStart):0;
  const cap=((w.end-w.start)*60-breakDur)*active.length; if(!cap)return null;
  const scheduled=allJobs.filter(j=>jobOverlapsDay(j,dk)).reduce((s,j)=>s+getSegment(j,dk,wh).duration,0);
  return{rate:Math.min(100,Math.round((scheduled/cap)*100)),scheduledMin:scheduled,capacityMin:cap};
}
// Gardé pour compatibilité
function computeFillRate(dk,allJobs,machines,wh){const i=computeFillInfo(dk,allJobs,machines,wh);return i?i.rate:null;}
function fillColor(r){return r>=90?"#EF4444":r>=70?"#F59E0B":"#22C55E";}
function FillBadge({info,dark}){
  if(!info)return null;
  const c=fillColor(info.rate);
  return(
    <div style={{display:"flex",alignItems:"center",gap:4}}>
      <div style={{width:30,height:3,borderRadius:99,background:dark?"rgba(255,255,255,0.2)":"#F0EDE8",overflow:"hidden"}}>
        <div style={{height:"100%",width:`${info.rate}%`,background:c,borderRadius:99}}/>
      </div>
      <span style={{fontSize:10,fontWeight:700,color:c}}>{info.rate}%</span>
      <span style={{fontSize:10,color:dark?"rgba(255,255,255,0.55)":"#A0AEC0",fontWeight:500}}>{fmtDur(info.scheduledMin)}</span>
    </div>
  );
}

// ─── Anti-chevauchement ────────────────────────────────────────────────────────
function findFirstAvailableSlot(machineId,proposedDate,proposedTime,durationMin,excludeKey,allJobsList,wh){
  const mJobs=allJobsList.filter(j=>j.machineId===machineId&&j.key!==excludeKey);
  let curDate=proposedDate,curMin=timeToMin(proposedTime),safety=0;
  while(safety++<90){
    const w=getWH(curDate,wh);
    if(!w.active){curDate=nextWorkingDay(curDate,wh);curMin=getWH(curDate,wh).start*60;continue;}
    const dayStart=w.start*60,dayEnd=w.end*60;
    if(curMin<dayStart)curMin=dayStart;
    if(curMin>=dayEnd){curDate=nextWorkingDay(curDate,wh);curMin=getWH(curDate,wh).start*60;continue;}
    const taskEndOnDay=Math.min(dayEnd,curMin+durationMin);
    const busy=mJobs
      .filter(j=>jobOverlapsDay(j,curDate))
      .map(j=>({segStart:getSegment(j,curDate,wh).segStart,segEnd:getSegment(j,curDate,wh).segEnd}));
    // Ajouter la pause méridienne comme créneau occupé
    const ww=getWH(curDate,wh);
    if(ww.breakActive&&ww.breakStart&&ww.breakEnd)busy.push({segStart:ww.breakStart,segEnd:ww.breakEnd});
    busy.sort((a,b)=>a.segStart-b.segStart);
    const conflict=busy.find(b=>curMin<b.segEnd&&taskEndOnDay>b.segStart);
    if(!conflict)return{startDate:curDate,startTime:minToTime(curMin)};
    curMin=conflict.segEnd;
    if(curMin>=dayEnd){curDate=nextWorkingDay(curDate,wh);curMin=getDayPeriods(curDate,wh)[0]?.start||getWH(curDate,wh).start*60;}
  }
  return{startDate:curDate,startTime:minToTime(curMin)};
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App(){
  const [authUser,     setAuthUser]     = useState(undefined);
  const [userProfile,  setUserProfile]  = useState(null);
  const [machines,     setMachines]     = useState(DEFAULT_MACHINES);
  const [allJobs,      setAllJobs]      = useState({});
  const [workingHours, setWorkingHours] = useState(DEFAULT_WH);
  const [notifs,       setNotifs]       = useState({});
  const [allUsers,     setAllUsers]     = useState({});
  const [dateKey,      setDateKey]      = useState(todayKey());
  const [modal,        setModal]        = useState(null);
  const [form,         setForm]         = useState({});
  const [view,         setView]         = useState("planning");
  const [showNotifs,   setShowNotifs]   = useState(false);
  const [showAdmin,    setShowAdmin]    = useState(false);
  const [draggingJob,  setDraggingJob]  = useState(null);
  const [dragOverCell, setDragOverCell] = useState(null);
  const [contextMenu,    setContextMenu]    = useState(null);
  const [pendingOrders,  setPendingOrders]  = useState({});
  const [showPending,    setShowPending]    = useState(false);
  const [pendingToAssign,setPendingToAssign]= useState(null); // ordre en cours d'affectation
  const [axonautLoading, setAxonautLoading] = useState(false);
  const [axonautMsg,     setAxonautMsg]     = useState("");
  const [loginErr,       setLoginErr]       = useState("");

  // ── Auth ──────────────────────────────────────────────────────────
  useEffect(()=>onAuthStateChanged(auth,(u)=>{
    setAuthUser(u||null);
    if(!u){setUserProfile(null);return;}
    onValue(ref(db,`users/${u.uid}`),(snap)=>{
      const d=snap.val();
      if(d)setUserProfile(d);
      else{const p={email:u.email,name:u.email.split("@")[0],role:"operateur"};update(ref(db,`users/${u.uid}`),p);setUserProfile(p);}
    });
  }),[]);

  // ── Machines depuis Firebase ───────────────────────────────────────
  useEffect(()=>{
    if(!authUser)return;
    return onValue(ref(db,"settings/machines"),(snap)=>{
      const d=snap.val();
      if(d){
        // Convertir objet Firebase en tableau trié
        const arr=Object.entries(d).map(([id,v])=>({id,...v})).filter(m=>m.active!==false);
        // Trier : mono d'abord, puis multi, par label
        arr.sort((a,b)=>{
          if(a.type!==b.type)return a.type==="mono"?-1:1;
          return a.label.localeCompare(b.label);
        });
        setMachines(arr.length>0?arr:DEFAULT_MACHINES);
      }
    });
  },[authUser]);

  // ── Horaires ──────────────────────────────────────────────────────
  useEffect(()=>{if(!authUser)return;return onValue(ref(db,"settings/workingHours"),(snap)=>{const d=snap.val();if(d)setWorkingHours({...DEFAULT_WH,...d});});},[authUser]);

  // ── Jobs globaux ──────────────────────────────────────────────────
  useEffect(()=>{if(!authUser)return;return onValue(ref(db,"jobs"),(snap)=>setAllJobs(snap.val()||{}));},[authUser]);

  // ── Notifs / Users ────────────────────────────────────────────────
  useEffect(()=>{if(!authUser||userProfile?.role!=="admin")return;return onValue(ref(db,"notifications"),(snap)=>setNotifs(snap.val()||{}));},[authUser,userProfile?.role]);
  useEffect(()=>{if(!authUser||userProfile?.role!=="admin")return;return onValue(ref(db,"users"),(snap)=>setAllUsers(snap.val()||{}));},[authUser,userProfile?.role]);

  // ── Commandes en attente Axonaut ────────────────────────────────
  useEffect(()=>{ if(!authUser||userProfile?.role!=="admin")return; return onValue(ref(db,"pendingOrders"),(snap)=>setPendingOrders(snap.val()||{})); },[authUser,userProfile?.role]);

  const logChange=useCallback(async(action,details)=>{
    if(!authUser||!userProfile)return;
    await push(ref(db,"notifications"),{ts:Date.now(),action,details,user:userProfile.name||userProfile.email,role:userProfile.role,read:false});
  },[authUser,userProfile]);

  // ── Dérivés ───────────────────────────────────────────────────────
  const role    = userProfile?.role||"lecteur";
  const can     = CAN[role]||CAN.lecteur;
  const jobsList= Object.entries(allJobs).map(([key,val])=>({...val,key}));
  const pendingOrdersList=Object.entries(pendingOrders||{}).map(([key,val])=>({...val,key})).sort((a,b)=>b.importedAt-a.importedAt);
  const dayJobs = jobsList.filter(j=>jobOverlapsDay(j,dateKey));
  const notifsList=Object.entries(notifs).map(([key,val])=>({...val,key})).sort((a,b)=>b.ts-a.ts);
  const unread  = notifsList.filter(n=>!n.read).length;
  const monoM   = machines.filter(m=>m.type==="mono");
  const multiM  = machines.filter(m=>m.type==="multi");

  // ── CRUD ──────────────────────────────────────────────────────────
  const openAdd=(machineId,startTime,dk=dateKey)=>{
    if(!can.add)return;
    const machine=machines.find(m=>m.id===machineId)||machines[0];
    const wh=getWH(dk,workingHours);
    const st=startTime||minToTime(wh.start*60);
    const{endDate,endTime}=computeEnd(dk,st,60,workingHours);
    setForm({machineId:machine?.id||machineId,startDate:dk,startTime:st,endDate,endTime,durationMin:60,durationDays:0,durationH:1,durationM:0,client:"",description:"",status:"En attente",couleur:randColor(),qty:0,unitTimeMin:0,headsUsed:machine?.heads||1});
    setModal({type:"add"});
  };
  const openEdit=(job)=>{
    if(role==="lecteur"){
      // Lecteur : fiche lecture seule avec statut modifiable
      setForm({...job});
      setModal({type:"view"});
      return;
    }
    if(!can.edit&&!can.delete)return;
    const tot=job.durationMin||0;
    setForm({...job,durationDays:Math.floor(tot/(8*60)),durationH:Math.floor((tot%(8*60))/60),durationM:tot%60,qty:job.qty||0,unitTimeMin:job.unitTimeMin||0,headsUsed:job.headsUsed||1});
    setModal({type:"edit"});
  };

  const updateFormDuration=(patch)=>{
    setForm(f=>{
      const nf={...f,...patch};
      const totMin=(nf.durationDays||0)*8*60+(nf.durationH||0)*60+(nf.durationM||0);
      const{endDate,endTime}=computeEnd(nf.startDate,nf.startTime,Math.max(1,totMin),workingHours);
      return{...nf,durationMin:Math.max(1,totMin),endDate,endTime};
    });
  };
  const updateFormStart=(patch)=>{
    setForm(f=>{
      const nf={...f,...patch};
      const{endDate,endTime}=computeEnd(nf.startDate,nf.startTime,nf.durationMin||60,workingHours);
      return{...nf,endDate,endTime};
    });
  };

  // Calcul automatique de la durée depuis qty/unitTime/heads
  const applyCalculator=(patch)=>{
    setForm(f=>{
      const nf={...f,...patch};
      const{qty=0,unitTimeMin=0,headsUsed=1}=nf;
      if(qty>0&&unitTimeMin>0&&headsUsed>0){
        const totMin=Math.ceil((qty*unitTimeMin)/headsUsed);
        const days=Math.floor(totMin/(8*60)),hours=Math.floor((totMin%(8*60))/60),mins=totMin%60;
        const{endDate,endTime}=computeEnd(nf.startDate,nf.startTime,totMin,workingHours);
        return{...nf,durationMin:totMin,durationDays:days,durationH:hours,durationM:mins,endDate,endTime};
      }
      return nf;
    });
  };

  const saveJob=async()=>{
    if(!form.client.trim())return;
    const{key,durationDays,durationH,durationM,...data}=form;
    // Anti-chevauchement : trouver le premier créneau libre
    const slot=findFirstAvailableSlot(data.machineId,data.startDate,data.startTime,data.durationMin,key||null,jobsList,workingHours);
    let finalData={...data};
    let shifted=false;
    if(slot.startDate!==data.startDate||slot.startTime!==data.startTime){
      const{endDate,endTime}=computeEnd(slot.startDate,slot.startTime,data.durationMin,workingHours);
      finalData={...data,startDate:slot.startDate,startTime:slot.startTime,endDate,endTime};
      shifted=true;
    }
    const m=machines.find(x=>x.id===finalData.machineId);
    const wd=countWorkDays(finalData.startDate,finalData.endDate,workingHours);
    let detail=`"${finalData.client}" sur ${m?.label}, ${fmtShortFR(finalData.startDate)} ${fmtTime(finalData.startTime)} → ${fmtShortFR(finalData.endDate)} ${fmtTime(finalData.endTime)} (${wd}j trav.)`;
    if(shifted)detail+=` · décalé automatiquement (chevauchement évité)`;
    if(modal.type==="add"){await push(ref(db,"jobs"),finalData);await logChange("ajout",`Ajout ${detail}`);}
    else{await update(ref(db,`jobs/${key}`),finalData);await logChange("modification",`Modif ${detail}`);}
    // Si la tâche vient d'une commande Axonaut, supprimer de la liste en attente
    if(pendingToAssign){
      await remove(ref(db,`pendingOrders/${pendingToAssign.axonautId}`));
      setPendingToAssign(null);
    }
    setModal(null);
  };
  const deleteJob=async(key,job)=>{
    if(!can.delete)return;
    const m=machines.find(x=>x.id===job.machineId);
    await remove(ref(db,`jobs/${key}`));
    await logChange("suppression",`Suppression "${job.client}" de ${m?.label}`);
    setModal(null);
  };

  // ── Drag & drop ───────────────────────────────────────────────────
  const onDragStart=(job)=>{if(!can.edit)return;setDraggingJob(job);};
  const onDragEnd  =()=>{setDraggingJob(null);setDragOverCell(null);};
  const onDrop     =async(machineId,newStartTime,newStartDate)=>{
    if(!draggingJob||!can.edit)return;
    const job=draggingJob;
    const fromM=machines.find(x=>x.id===job.machineId);
    const toM  =machines.find(x=>x.id===machineId);

    // Si la machine change ET que la tâche a un calcul qty/temps unitaire,
    // recalculer la durée avec le nombre de têtes de la nouvelle machine
    let newDurationMin=job.durationMin;
    let durationChanged=false;
    if(machineId!==job.machineId && job.qty>0 && job.unitTimeMin>0 && toM?.heads){
      newDurationMin=Math.ceil((job.qty*job.unitTimeMin)/toM.heads);
      durationChanged=true;
    }

    // Anti-chevauchement sur la machine cible
    const slot=findFirstAvailableSlot(machineId,newStartDate,newStartTime,newDurationMin,job.key,jobsList,workingHours);
    const{endDate,endTime}=computeEnd(slot.startDate,slot.startTime,newDurationMin,workingHours);
    const updates={machineId,startDate:slot.startDate,startTime:slot.startTime,endDate,endTime};
    if(durationChanged){ updates.durationMin=newDurationMin; updates.headsUsed=toM.heads; }

    await update(ref(db,`jobs/${job.key}`),updates);

    let detail=`Déplacement "${job.client}" : ${fromM?.label} ${fmtShortFR(job.startDate)} ${fmtTime(job.startTime)} → ${toM?.label} ${fmtShortFR(slot.startDate)} ${fmtTime(slot.startTime)}`;
    if(slot.startDate!==newStartDate||slot.startTime!==newStartTime) detail+=` · décalé (chevauchement évité)`;
    if(durationChanged) detail+=` · durée recalculée ${fmtDur(newDurationMin)} (${toM.heads} tête${toM.heads>1?"s":""})`;
    await logChange("deplacement",detail);
    setDraggingJob(null);setDragOverCell(null);
  };

  const changeJobStatus=async(job,newStatus)=>{
    await update(ref(db,`jobs/${job.key}`),{status:newStatus});
    await logChange("modification",`Statut "${job.client}" → ${STATUS_LABELS[newStatus]} (${MACHINES.find(m=>m.id===job.machineId)?.label||job.machineId})`);
    setContextMenu(null);
  };
  // ── Import Axonaut ───────────────────────────────────────────────
  const importFromAxonaut=async()=>{
    setAxonautLoading(true); setAxonautMsg("");
    try{
      const res=await fetch("/api/axonaut?endpoint=opportunities&limit=100");
      if(!res.ok)throw new Error("HTTP "+res.status);
      const raw=await res.json();
      // L'API peut retourner un tableau direct ou { data:[...] }
      const orders=Array.isArray(raw)?raw:(raw.data||raw.results||raw.opportunities||[]);
      const existingPending=Object.keys(pendingOrders||{});
      const existingJobs=jobsList.map(j=>String(j.axonautId)).filter(Boolean);
      let added=0;
      for(const opp of orders){
        const id=String(opp.id||opp.uid||"");
        if(!id||existingPending.includes(id)||existingJobs.includes(id))continue;
        // Statuts "Gagné" / "Won" = commande confirmée
        const st=(opp.status||opp.state||opp.status_label||"").toLowerCase();
        const isWon=!st||st.includes("won")||st.includes("gagn")||st.includes("accept")||st.includes("confirm");
        if(!isWon)continue;
        await set(ref(db,`pendingOrders/${id}`),{
          axonautId:id,
          client:opp.company?.name||opp.customer?.name||opp.contact?.name||"Client",
          description:opp.name||opp.title||opp.subject||"",
          amount:opp.amount||opp.total_amount||opp.price||0,
          reference:opp.reference||opp.number||id,
          createdAt:opp.created_at||opp.date||"",
          importedAt:Date.now(),
          rawStatus:opp.status||opp.state||"",
        });
        added++;
      }
      setAxonautMsg(added>0?`✅ ${added} commande${added>1?"s":""} importée${added>1?"s":""} avec succès.`:`ℹ️ Aucune nouvelle commande. (${orders.length} vérifiées)`);
    }catch(e){
      setAxonautMsg("❌ Erreur : "+e.message+". Vérifiez la variable AXONAUT_API_KEY dans Vercel.");
    }finally{setAxonautLoading(false);}
  };

  const assignOrder=(order)=>{
    // Pré-remplit le formulaire avec les données Axonaut
    const wh=getWH(dateKey,workingHours);
    const st=minToTime(wh.start*60);
    const{endDate,endTime}=computeEnd(dateKey,st,60,workingHours);
    const firstMachine=machines[0];
    setForm({machineId:firstMachine?.id,startDate:dateKey,startTime:st,endDate,endTime,
      durationMin:60,durationDays:0,durationH:1,durationM:0,
      client:order.client,description:order.description,
      status:"En attente",couleur:randColor(),
      qty:0,unitTimeMin:0,headsUsed:firstMachine?.heads||1,
      axonautId:order.axonautId,axonautRef:order.reference,
    });
    setPendingToAssign(order);
    setModal({type:"add"});
  };

  const discardOrder=async(order)=>{
    if(!window.confirm(`Ignorer la commande "${order.client}" ?`))return;
    await remove(ref(db,`pendingOrders/${order.axonautId}`));
  };

  const markAllRead   =async()=>{const u={};Object.keys(notifs).forEach(k=>{u[`notifications/${k}/read`]=true;});await update(ref(db),u);};
  const deleteAllNotifs=async()=>{ if(!window.confirm("Supprimer toutes les notifications ?"))return; await remove(ref(db,"notifications")); };
  const deleteNotif=async(k)=>remove(ref(db,`notifications/${k}`));

  if(authUser===undefined)return<Loader/>;
  if(!authUser)return<LoginScreen error={loginErr} onLogin={async(e,p)=>{try{setLoginErr("");await signInWithEmailAndPassword(auth,e,p);}catch{setLoginErr("Email ou mot de passe incorrect.");}}} />;

  const wh=getWH(dateKey,workingHours);
  const dayActive=wh.active!==false;
  const dragProps={draggingJob,dragOverCell,setDragOverCell,onDragStart,onDragEnd,onDrop,can,onContextMenu:(e,job)=>{e.preventDefault();e.stopPropagation();setContextMenu({job,x:e.clientX,y:e.clientY});}};
  const currentMachine=machines.find(m=>m.id===form.machineId);

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
            :<><div style={{color:"white",fontSize:11,fontWeight:600}}>{fmtDateFR(dateKey)}</div><FillBadge info={computeFillInfo(dateKey,jobsList,machines,workingHours)} dark={true}/>{isToday(dateKey)&&<div style={{fontSize:10,color:"#81B29A",fontWeight:600}}>Aujourd'hui</div>}</>}
          </div>
          <button onClick={()=>setDateKey(k=>offsetDate(k,view==="semaine"?7:1))} style={navBtn}>›</button>
          <button onClick={()=>setDateKey(todayKey())} style={{...navBtn,fontSize:10,width:"auto",padding:"0 8px"}}>Auj.</button>
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {[["planning","📅 Jour"],["semaine","📆 Semaine"],["recap","📊 Récap"]].map(([v,label])=>(
            <button key={v} onClick={()=>setView(v)} style={{background:view===v?"#E07A5F":"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:7,padding:"6px 11px",fontWeight:600,cursor:"pointer",fontSize:11}}>{label}</button>
          ))}
          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>
          {role==="admin"&&<button onClick={()=>{setShowNotifs(v=>!v);setShowAdmin(false);}} style={{...iconBtn,position:"relative"}}>🔔{unread>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#E07A5F",color:"white",borderRadius:99,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{unread}</span>}</button>}
          {role==="admin"&&<button onClick={()=>{setShowAdmin(v=>!v);setShowNotifs(false);setShowPending(false);}} style={iconBtn}>⚙️</button>}
          {role==="admin"&&(
            <button onClick={()=>{setShowPending(v=>!v);setShowNotifs(false);setShowAdmin(false);}} style={{...iconBtn,position:"relative",background:showPending?"#E07A5F":"rgba(255,255,255,0.15)"}} title="Commandes Axonaut en attente">
              📥
              {pendingOrdersList.length>0&&<span style={{position:"absolute",top:-4,right:-4,background:"#F59E0B",color:"white",borderRadius:99,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{pendingOrdersList.length}</span>}
            </button>
          )}
          <button onClick={()=>signOut(auth)} style={{...iconBtn,opacity:0.7}}>🚪</button>
        </div>
      </div>

      {showPending&&role==="admin"&&<PendingOrdersPanel orders={pendingOrdersList} onImport={importFromAxonaut} onAssign={assignOrder} onDiscard={discardOrder} loading={axonautLoading} msg={axonautMsg} onClose={()=>setShowPending(false)}/>}
      {showNotifs&&role==="admin"&&<NotifPanel notifs={notifsList} onMarkRead={markAllRead} onDelete={deleteNotif} onDeleteAll={deleteAllNotifs} onClose={()=>setShowNotifs(false)}/>}
      {showAdmin &&role==="admin"&&<AdminPanel allUsers={allUsers} workingHours={workingHours} machines={machines} onClose={()=>setShowAdmin(false)}/>}

      {view==="planning"&&<PlanningView monoM={monoM} multiM={multiM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} dayActive={dayActive} workingHours={workingHours} machines={machines} openAdd={openAdd} openEdit={openEdit} {...dragProps}/>}
      {view==="semaine" &&<WeekView monoM={monoM} multiM={multiM} allJobs={jobsList} mondayKey={getMondayKey(dateKey)} workingHours={workingHours} machines={machines} openAdd={openAdd} openEdit={openEdit} onDayClick={(dk)=>{setDateKey(dk);setView("planning");}} {...dragProps}/>}
      {view==="recap"   &&<RecapView dayJobs={dayJobs} allJobs={jobsList} machines={machines} dateKey={dateKey} workingHours={workingHours}/>}

      {/* ── Menu contextuel clic droit ── */}
      {contextMenu&&(
        <div onClick={()=>setContextMenu(null)} style={{position:"fixed",inset:0,zIndex:2000}}>
          <div onClick={e=>e.stopPropagation()} style={{position:"fixed",top:Math.min(contextMenu.y,window.innerHeight-220),left:Math.min(contextMenu.x,window.innerWidth-200),background:"white",borderRadius:10,boxShadow:"0 8px 30px rgba(0,0,0,0.18)",padding:8,minWidth:190,zIndex:2001}}>
            <div style={{fontSize:11,fontWeight:700,color:"#718096",padding:"4px 8px",marginBottom:4,borderBottom:"1px solid #F0EDE8"}}>
              🎨 Changer le statut
            </div>
            <div style={{fontSize:11,fontWeight:600,color:"#2D3748",padding:"4px 8px 8px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{contextMenu.job.client}</div>
            {Object.entries(STATUS_LABELS).map(([k,v])=>{
              const sc=STATUS_COLORS[k];
              const isCurrent=contextMenu.job.status===k;
              return(
                <div key={k} onClick={()=>changeJobStatus(contextMenu.job,k)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:7,cursor:isCurrent?"default":"pointer",background:isCurrent?sc.bg:"transparent",marginBottom:2,transition:"background .1s"}}
                  onMouseEnter={e=>{if(!isCurrent)e.currentTarget.style.background="#F7F4F0";}}
                  onMouseLeave={e=>{if(!isCurrent)e.currentTarget.style.background="transparent";}}>
                  <div style={{width:8,height:8,borderRadius:"50%",background:sc.border,flexShrink:0}}/>
                  <span style={{fontSize:12,fontWeight:isCurrent?700:400,color:isCurrent?sc.text:"#2D3748"}}>{v}</span>
                  {isCurrent&&<span style={{marginLeft:"auto",fontSize:10,color:sc.text}}>✓ actuel</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Modal vue lecteur (lecture seule + statut) ── */}
      {modal?.type==="view"&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:24,width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
            {/* Entête */}
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
              <div style={{width:10,height:10,borderRadius:"50%",background:form.couleur,flexShrink:0}}/>
              <div style={{flex:1}}>
                <div style={{fontSize:15,fontWeight:700,color:"#1A1A2E"}}>{form.client}</div>
                {form.description&&<div style={{fontSize:12,color:"#718096"}}>{form.description}</div>}
              </div>
              <button onClick={()=>setModal(null)} style={{background:"#F7F4F0",border:"none",borderRadius:7,width:26,height:26,cursor:"pointer",fontSize:14,color:"#718096"}}>×</button>
            </div>

            {/* Infos en lecture seule */}
            <div style={{background:"#F7F9FC",borderRadius:10,padding:"12px 14px",marginBottom:14,display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px 16px"}}>
              {[
                {label:"Machine",   value:machines.find(m=>m.id===form.machineId)?.label||form.machineId},
                {label:"Durée",     value:fmtDur(form.durationMin)},
                {label:"Début",     value:`${fmtDateFR(form.startDate)} ${fmtTime(form.startTime)}`},
                {label:"Fin",       value:`${fmtDateFR(form.endDate)} ${fmtTime(form.endTime)}`},
                ...(form.qty>0?[{label:"Articles", value:`${form.qty} × ${form.unitTimeMin}min`}]:[]),
              ].map(({label,value})=>(
                <div key={label}>
                  <div style={{fontSize:10,fontWeight:600,color:"#A0AEC0",marginBottom:2}}>{label}</div>
                  <div style={{fontSize:12,fontWeight:600,color:"#2D3748"}}>{value}</div>
                </div>
              ))}
            </div>

            {/* Statut modifiable */}
            <div style={{marginBottom:16}}>
              <label style={{fontSize:11,fontWeight:700,color:"#4A5568",display:"block",marginBottom:8}}>🎨 Modifier le statut</label>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                {Object.entries(STATUS_LABELS).map(([k,v])=>{
                  const sc=STATUS_COLORS[k];
                  const isCurrent=form.status===k;
                  return(
                    <div key={k} onClick={()=>setForm(f=>({...f,status:k}))}
                      style={{display:"flex",alignItems:"center",gap:7,padding:"8px 10px",borderRadius:8,cursor:"pointer",
                        border:`2px solid ${isCurrent?sc.border:"#E2E8F0"}`,background:isCurrent?sc.bg:"white",transition:"all .15s"}}
                      onMouseEnter={e=>{if(!isCurrent)e.currentTarget.style.borderColor=sc.border;}}
                      onMouseLeave={e=>{if(!isCurrent)e.currentTarget.style.borderColor="#E2E8F0";}}>
                      <div style={{width:8,height:8,borderRadius:"50%",background:sc.border,flexShrink:0}}/>
                      <span style={{fontSize:12,fontWeight:isCurrent?700:400,color:isCurrent?sc.text:"#4A5568"}}>{v}</span>
                      {isCurrent&&<span style={{marginLeft:"auto",fontSize:12}}>✓</span>}
                    </div>
                  );
                })}
              </div>
            </div>

            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setModal(null)} style={{flex:1,padding:"9px",borderRadius:8,border:"1.5px solid #E2E8F0",background:"white",fontWeight:600,cursor:"pointer",fontSize:12,color:"#4A5568"}}>Fermer</button>
              <button onClick={()=>{ changeJobStatus(form,form.status); setModal(null); }}
                style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"#1A1A2E",color:"white",fontWeight:700,cursor:"pointer",fontSize:12}}>
                ✓ Enregistrer le statut
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Modal ── */}
      {modal&&(
        <div onClick={()=>setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"white",borderRadius:16,padding:24,width:460,boxShadow:"0 20px 60px rgba(0,0,0,0.25)",maxHeight:"92vh",overflowY:"auto"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#1A1A2E"}}>{modal.type==="add"?"➕ Nouvelle commande":"✏️ Modifier"}</div>

            {/* Client + Description */}
            {[{label:"Client *",key:"client",ph:"Nom du client"},{label:"Description",key:"description",ph:"Ex: Polos col V"}].map(({label,key,ph})=>(
              <div key={key} style={{marginBottom:10}}>
                <label style={lbl}>{label}</label>
                <input value={form[key]||""} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))} placeholder={ph} style={inp}/>
              </div>
            ))}

            {/* Machine + Statut */}
            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={lbl}>Machine</label>
                <select value={form.machineId||machines[0]?.id} onChange={e=>{
                  const m=machines.find(x=>x.id===e.target.value);
                  const newHeads=m?.heads||1;
                  setForm(f=>{
                    const nf={...f,machineId:e.target.value,headsUsed:newHeads};
                    // Recalcule la durée automatiquement si qty et unitTimeMin sont remplis
                    if(nf.qty>0&&nf.unitTimeMin>0){
                      const totMin=Math.ceil((nf.qty*nf.unitTimeMin)/newHeads);
                      const days=Math.floor(totMin/(8*60)),hours=Math.floor((totMin%(8*60))/60),mins=totMin%60;
                      const wh=getWH(nf.startDate,workingHours);
                      const startMin=(wh.start||8)*60;
                      const st=nf.startTime||minToTime(startMin);
                      const end=computeEnd(nf.startDate,st,totMin,workingHours);
                      return{...nf,durationMin:totMin,durationDays:days,durationH:hours,durationM:mins,...end};
                    }
                    return nf;
                  });
                }} style={sel}>
                  {machines.map(m=><option key={m.id} value={m.id}>{m.label} ({m.heads} tête{m.heads>1?"s":""})</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={lbl}>Statut</label>
                <select value={form.status||"En attente"} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={sel}>
                  {Object.entries(STATUS_LABELS).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            {/* ── Calculateur de durée ── */}
            <div style={{background:"#F0F7FF",border:"1.5px solid #93C5FD",borderRadius:10,padding:12,marginBottom:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#1D4ED8",marginBottom:8}}>🧮 Calculateur de durée</div>
              <div style={{display:"flex",gap:8,marginBottom:8,alignItems:"flex-end"}}>
                <div style={{flex:2}}>
                  <label style={{...lbl,color:"#1D4ED8"}}>Nb d'articles</label>
                  <input type="number" min={0} value={form.qty||""} placeholder="ex: 100"
                    onChange={e=>applyCalculator({qty:+e.target.value})} style={{...inp,borderColor:"#93C5FD"}}/>
                </div>
                <div style={{color:"#93C5FD",fontSize:18,paddingBottom:8}}>×</div>
                <div style={{flex:2}}>
                  <label style={{...lbl,color:"#1D4ED8"}}>Temps unitaire (min)</label>
                  <input type="number" min={0} step={0.5} value={form.unitTimeMin||""} placeholder="ex: 5"
                    onChange={e=>applyCalculator({unitTimeMin:+e.target.value})} style={{...inp,borderColor:"#93C5FD"}}/>
                </div>
                <div style={{color:"#93C5FD",fontSize:18,paddingBottom:8}}>÷</div>
                <div style={{flex:2}}>
                  <label style={{...lbl,color:"#1D4ED8"}}>Têtes utilisées</label>
                  <select value={form.headsUsed||1} onChange={e=>applyCalculator({headsUsed:+e.target.value})} style={{...sel,borderColor:"#93C5FD"}}>
                    {Array.from({length:currentMachine?.heads||1},(_,i)=>i+1).map(n=><option key={n} value={n}>{n} tête{n>1?"s":""}</option>)}
                  </select>
                </div>
              </div>
              {/* Résultat du calcul */}
              {(form.qty>0&&form.unitTimeMin>0&&form.headsUsed>0)&&(
                <div style={{background:"white",borderRadius:7,padding:"7px 10px",fontSize:12,color:"#1D4ED8",fontWeight:600}}>
                  {form.qty} art. × {form.unitTimeMin}min ÷ {form.headsUsed} tête{form.headsUsed>1?"s":""} = <strong>{fmtDur(form.durationMin)}</strong>
                  {currentMachine&&<span style={{fontWeight:400,color:"#93C5FD",marginLeft:6}}>({currentMachine.label})</span>}
                </div>
              )}
              {(!form.qty||!form.unitTimeMin)&&<div style={{fontSize:11,color:"#93C5FD"}}>Renseignez les champs ci-dessus pour calculer automatiquement la durée ↓</div>}
            </div>

            {/* Début */}
            <div style={{background:"#F7F9FC",borderRadius:10,padding:"12px",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#4A5568",marginBottom:8}}>📅 Début</div>
              <div style={{display:"flex",gap:10}}>
                <div style={{flex:1}}><label style={lbl}>Date</label><input type="date" value={form.startDate||todayKey()} onChange={e=>updateFormStart({startDate:e.target.value})} style={inp}/></div>
                <div style={{flex:1}}><label style={lbl}>Heure</label><input type="time" value={form.startTime||"08:00"} onChange={e=>updateFormStart({startTime:e.target.value})} style={inp}/></div>
              </div>
            </div>

            {/* Durée */}
            <div style={{background:"#F7F9FC",borderRadius:10,padding:"12px",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#4A5568",marginBottom:8}}>⏱ Durée <span style={{fontWeight:400,color:"#A0AEC0"}}>(jours non travaillés ignorés)</span></div>
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
              <div style={{fontSize:11,color:"#718096"}}>Durée totale : <strong>{fmtDur(form.durationMin||60)}</strong></div>
            </div>

            {/* Fin calculée */}
            {form.endDate&&(
              <div style={{background:form.startDate===form.endDate?"#F0FDF4":"#EBF4FF",border:`1.5px solid ${form.startDate===form.endDate?"#A3CFBB":"#93C5FD"}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}>
                <div style={{fontSize:11,color:"#4A5568",fontWeight:600,marginBottom:2}}>
                  {form.startDate===form.endDate?"✅ Tâche sur une journée":"📆 Tâche multi-jours"}
                </div>
                <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E"}}>Fin : {fmtDateFR(form.endDate)} à {fmtTime(form.endTime)}</div>
                {form.startDate!==form.endDate&&<div style={{fontSize:11,color:"#718096",marginTop:2}}>{countWorkDays(form.startDate,form.endDate,workingHours)} jours travaillés</div>}
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
function PlanningView({monoM,multiM,dayJobs,dateKey,wh,dayActive,workingHours,machines,openAdd,openEdit,...dragProps}){
  const byS=Object.keys(STATUS_COLORS).reduce((a,s)=>{a[s]=dayJobs.filter(j=>j.status===s).length;return a;},{});
  return(
    <div style={{padding:"12px 10px"}}>
      {!dayActive&&<div style={{background:"#FFF3CD",border:"1px solid #FFDA6A",borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:12,color:"#856404",fontWeight:600}}>⚠️ Ce jour est marqué comme non travaillé.</div>}
      <div style={{display:"flex",gap:7,marginBottom:12,flexWrap:"wrap",alignItems:"center"}}>
        {[{label:"Total",value:dayJobs.length,icon:"📋",bg:"#1A1A2E",color:"white"},
          ...Object.entries(byS).map(([s,n])=>({label:STATUS_LABELS[s],value:n,icon:s==="En cours"?"⚙️":s==="Urgent"?"🚨":s==="Termine"?"✅":"⏳",bg:STATUS_COLORS[s].bg,color:STATUS_COLORS[s].text}))
        ].map(({label,value,icon,bg,color})=>(
          <div key={label} style={{background:bg,color,borderRadius:9,padding:"6px 11px",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:11,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
            <span>{icon}</span><span style={{fontSize:14,fontWeight:800}}>{value}</span><span style={{opacity:0.8}}>{label}</span>
          </div>
        ))}
        {dragProps.can.edit&&<div style={{marginLeft:"auto",fontSize:11,color:"#A0AEC0",fontStyle:"italic"}}>✋ Glissez (snap 5min)</div>}
      </div>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        {monoM.length>0&&<TimelineGrid label="🪡 Mono-Têtes" machines={monoM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" {...dragProps}/>}
        {monoM.length>0&&multiM.length>0&&<div style={{height:1,background:"#F0EDE8"}}/>}
        {multiM.length>0&&<TimelineGrid label="🎛 Multi-Têtes" machines={multiM} dayJobs={dayJobs} dateKey={dateKey} wh={wh} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" {...dragProps}/>}
      </div>
    </div>
  );
}

// ─── Timeline pixel ────────────────────────────────────────────────────────────
function TimelineGrid({label,machines,dayJobs,dateKey,wh,workingHours,openAdd,openEdit,headerColor,draggingJob,dragOverCell,setDragOverCell,onDragStart,onDragEnd,onDrop,can,onContextMenu}){
  // Positionnement en pourcentages : la timeline s'adapte automatiquement à l'écran
  const dayStartMin=(wh.start||8)*60,dayEndMin=(wh.end||18)*60,dayDur=dayEndMin-dayStartMin;
  const pct =(m)=>((m-dayStartMin)/dayDur*100).toFixed(5)+"%";
  const wpct=(d)=>(d/dayDur*100).toFixed(5)+"%";
  const timeFromX=(clientX,rect)=>snapMin(Math.max(dayStartMin,Math.min(dayEndMin-5,dayStartMin+(clientX-rect.left)/rect.width*dayDur)));
  const isDragging=draggingJob!=null;
  const hourMarkers=[],halfMarkers=[];
  for(let m=dayStartMin;m<=dayEndMin;m+=60)hourMarkers.push(m);
  for(let m=dayStartMin+30;m<dayEndMin;m+=60)halfMarkers.push(m);
  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{display:"flex",overflowX:"auto"}}>
        {/* Colonne labels — largeur fixe */}
        <div style={{width:LABEL_W,flexShrink:0,borderRight:"1px solid #F0EDE8"}}>
          <div style={{height:32,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8"}}/>
          {machines.map((m,mi)=>(
            <div key={m.id} style={{height:ROW_H,display:"flex",alignItems:"center",padding:"0 8px",background:mi%2===0?"white":"#FDFCFB",borderBottom:"1px solid #F7F4F0"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:7,height:7,borderRadius:"50%",background:m.color,flexShrink:0}}/>
                <div>
                  <div style={{fontSize:13,fontWeight:600,color:"#2D3748",whiteSpace:"nowrap"}}>{m.label}</div>
                  <div style={{fontSize:11,color:"#A0AEC0"}}>{m.heads} tête{m.heads>1?"s":""}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
        {/* Colonne timeline — flex:1 remplit tout l'espace disponible */}
        <div style={{flex:1,minWidth:MIN_TIMELINE,position:"relative"}}>
          {/* En-tête heures */}
          <div style={{height:32,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"relative"}}>
            {hourMarkers.map(m=>(
              <div key={m} style={{position:"absolute",left:pct(m),top:0,bottom:0,borderLeft:m===dayStartMin?"none":"1px solid #E2E8F0",display:"flex",alignItems:"center",paddingLeft:4}}>
                <span style={{fontSize:12,fontWeight:600,color:"#718096",whiteSpace:"nowrap"}}>{fmtTime(minToTime(m))}</span>
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
                onDragOver={e=>{e.preventDefault();if(can.edit)setDragOverCell({machineId:machine.id,dk:dateKey});}}
                onDragLeave={()=>setDragOverCell(null)}
                onDrop={e=>{e.preventDefault();if(!draggingJob||!can.edit)return;onDrop(machine.id,minToTime(timeFromX(e.clientX,e.currentTarget.getBoundingClientRect())),dateKey);}}
                onClick={e=>{if(isDragging||!can.add)return;openAdd(machine.id,minToTime(timeFromX(e.clientX,e.currentTarget.getBoundingClientRect())),dateKey);}}>
                {halfMarkers.map(m=><div key={m} style={{position:"absolute",left:pct(m),top:0,bottom:0,borderLeft:"1px dashed #F0EDE8",pointerEvents:"none"}}/>)}
                {hourMarkers.filter(m=>m>dayStartMin).map(m=><div key={m} style={{position:"absolute",left:pct(m),top:0,bottom:0,borderLeft:"1px solid #E8E8E8",pointerEvents:"none"}}/>)}
                {/* Zone pause */}
                {wh.breakActive&&wh.breakStart&&wh.breakEnd&&wh.breakStart>dayStartMin&&wh.breakEnd<dayEndMin&&(
                  <div style={{position:"absolute",left:pct(wh.breakStart),width:wpct(wh.breakEnd-wh.breakStart),top:0,bottom:0,background:"repeating-linear-gradient(45deg,rgba(0,0,0,0.035) 0,rgba(0,0,0,0.035) 3px,transparent 3px,transparent 7px)",borderLeft:"1.5px dashed #D1D5DB",borderRight:"1.5px dashed #D1D5DB",pointerEvents:"none",zIndex:3,display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <span style={{fontSize:11,color:"#9CA3AF",fontWeight:600,background:"rgba(255,255,255,0.85)",padding:"2px 5px",borderRadius:3,whiteSpace:"nowrap"}}>🍽 pause</span>
                  </div>
                )}
                {/* Tâches */}
                {mJobs.map(job=>{
                  const seg=getSegment(job,dateKey,workingHours);
                  const sc=STATUS_COLORS[job.status],isGhost=draggingJob?.key===job.key;
                  const showTime=seg.duration/dayDur>0.05;
                  return(
                    <div key={job.key} draggable={can.edit}
                      onDragStart={e=>{e.stopPropagation();onDragStart(job);}} onDragEnd={onDragEnd}
                      onClick={e=>{e.stopPropagation();if(!isDragging)openEdit(job);}}
                      onContextMenu={e=>onContextMenu(e,job)}
                      title={`${job.client}${job.description?" – "+job.description:""}
${fmtDateFR(job.startDate)} ${fmtTime(job.startTime)} → ${fmtDateFR(job.endDate)} ${fmtTime(job.endTime)}
${job.qty?`${job.qty}x ${job.unitTimeMin}min ÷ ${job.headsUsed}t = ${fmtDur(job.durationMin)}`:""}
Clic droit = statut`}
                      style={{position:"absolute",left:pct(seg.segStart),width:"calc("+wpct(seg.duration)+" - 2px)",minWidth:10,
                        top:5,bottom:5,background:sc.bg,border:`1.5px solid ${sc.border}`,
                        borderLeft:seg.before?"3px dashed "+job.couleur:`3px solid ${job.couleur}`,
                        borderRight:seg.after?"2px dashed "+sc.border:`1.5px solid ${sc.border}`,
                        borderRadius:`${seg.before?0:6}px ${seg.after?0:6}px ${seg.after?0:6}px ${seg.before?0:6}px`,
                        padding:"3px 5px",overflow:"hidden",cursor:can.edit?(isDragging?"grabbing":"grab"):"pointer",
                        opacity:isGhost?0.25:1,userSelect:"none",zIndex:1,transition:"opacity .15s,box-shadow .1s"}}
                      onMouseEnter={e=>{if(!isDragging&&can.edit)e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.18)";e.currentTarget.style.zIndex=10;}}
                      onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";e.currentTarget.style.zIndex=1;}}>
                      {seg.before&&<span style={{fontSize:11,color:job.couleur,fontWeight:900,marginRight:2}}>◀</span>}
                      <span style={{fontSize:13,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                        {job.client}{job.qty>0&&<span style={{fontSize:11,opacity:0.7,marginLeft:3}}>{job.qty}×</span>}
                      </span>
                      {seg.after&&<span style={{fontSize:11,color:job.couleur,fontWeight:900,position:"absolute",right:3,top:"50%",transform:"translateY(-50%)"}}>▶</span>}
                      {showTime&&<div style={{fontSize:12,color:sc.text,opacity:0.65}}>{fmtTime(minToTime(seg.segStart))}→{fmtTime(minToTime(seg.segEnd))}</div>}
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
  );
}
// ─── Vue Semaine ───────────────────────────────────────────────────────────────
function WeekView({monoM,multiM,allJobs,mondayKey,workingHours,machines,openAdd,openEdit,onDayClick,...dragProps}){
  const weekKeys=getWeekKeys(mondayKey);
  const activeDays=weekKeys.filter(k=>isWorkingDay(k,workingHours));
  return(
    <div style={{padding:"12px 10px"}}>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        {monoM.length>0&&<WeekGrid label="🪡 Mono-Têtes" machines={monoM} allJobs={allJobs} weekKeys={activeDays} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" onDayClick={onDayClick} {...dragProps}/>}
        {monoM.length>0&&multiM.length>0&&<div style={{height:1,background:"#F0EDE8"}}/>}
        {multiM.length>0&&<WeekGrid label="🎛 Multi-Têtes" machines={multiM} allJobs={allJobs} weekKeys={activeDays} workingHours={workingHours} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" onDayClick={onDayClick} {...dragProps}/>}
      </div>
    </div>
  );
}

function WeekGrid({label,machines,allJobs,weekKeys,workingHours,openAdd,openEdit,headerColor,onDayClick,draggingJob,setDragOverCell,onDragStart,onDragEnd,onDrop,can,onContextMenu}){
  const isDragging=draggingJob!=null;
  return(
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:560}}>
          <thead><tr>
            <th style={{width:96,padding:"8px 11px",textAlign:"left",fontSize:11,color:"#718096",fontWeight:600,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"sticky",left:0,zIndex:2}}>Machine</th>
            {weekKeys.map(dk=>(
              <th key={dk} onClick={()=>onDayClick(dk)} style={{padding:"8px 6px",fontSize:11,color:isToday(dk)?"#E07A5F":"#718096",fontWeight:isToday(dk)?800:600,background:isToday(dk)?"#FFF5F3":"#FAFAF8",borderBottom:"1px solid #F0EDE8",textAlign:"center",cursor:"pointer",borderLeft:"1px solid #F0EDE8",minWidth:110}}>
                <div>{DAYS_FR[getDayIdx(dk)]}</div>
                <div style={{fontSize:10,fontWeight:400,color:isToday(dk)?"#E07A5F":"#A0AEC0"}}>{fmtShortFR(dk)}</div>
                <div style={{display:"flex",justifyContent:"center",marginTop:2}}>
                  <FillBadge info={computeFillInfo(dk,allJobs,machines,workingHours)} dark={false}/>
                </div>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {machines.map((machine,mi)=>(
              <tr key={machine.id} style={{background:mi%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"8px 10px",fontWeight:600,fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0",whiteSpace:"nowrap",position:"sticky",left:0,background:mi%2===0?"white":"#FDFCFB",zIndex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:7,height:7,borderRadius:"50%",background:machine.color}}/><div><div>{machine.label}</div><div style={{fontSize:9,color:"#A0AEC0"}}>{machine.heads} tête{machine.heads>1?"s":""}</div></div></div>
                </td>
                {weekKeys.map(dk=>{
                  const wh=getWH(dk,workingHours);
                  const dayJobsList=allJobs.filter(j=>j.machineId===machine.id&&jobOverlapsDay(j,dk));
                  return(
                    <td key={dk} onClick={()=>{if(!isDragging&&can.add)openAdd(machine.id,minToTime(wh.start*60),dk);}}
                      onDragOver={e=>{e.preventDefault();if(can.edit)setDragOverCell({machineId:machine.id,dk});}}
                      onDragLeave={()=>setDragOverCell(null)}
                      onDrop={e=>{e.preventDefault();if(draggingJob&&can.edit)onDrop(machine.id,draggingJob.startTime,dk);}}
                      style={{padding:5,verticalAlign:"top",borderBottom:"1px solid #F7F4F0",borderLeft:"1px solid #F0EDE8",minWidth:110,minHeight:60,cursor:isDragging&&can.edit?"copy":can.add?"cell":"default",background:isToday(dk)?"#FDFCFA":"transparent"}}>
                      <div style={{display:"flex",flexDirection:"column",gap:3,minHeight:54}}>
                        {dayJobsList.sort((a,b)=>timeToMin(a.startTime)-timeToMin(b.startTime)).map(job=>{
                          const sc=STATUS_COLORS[job.status],seg=getSegment(job,dk,workingHours);
                          return(
                            <div key={job.key} draggable={can.edit} onDragStart={e=>{e.stopPropagation();onDragStart(job);}} onDragEnd={onDragEnd}
                              onClick={e=>{e.stopPropagation();if(!isDragging)openEdit(job);}}
                              onContextMenu={e=>onContextMenu(e,job)}
                              style={{background:sc.bg,border:`1.5px solid ${sc.border}`,borderLeft:seg.before?`3px dashed ${job.couleur}`:`3px solid ${job.couleur}`,borderRadius:6,padding:"3px 6px",cursor:can.edit?"grab":"default",userSelect:"none"}}
                              onMouseEnter={e=>{if(can.edit)e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,0.12)";}}
                              onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
                              <div style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                                {seg.before&&<span style={{fontSize:11,color:job.couleur,fontWeight:900,marginRight:2}}>◀</span>}
                                {job.client}{job.qty>0&&<span style={{fontSize:9,opacity:0.7,marginLeft:2}}>{job.qty}×</span>}
                                {seg.after&&<span style={{fontSize:9,color:job.couleur,fontWeight:900,marginLeft:2}}>▶</span>}
                              </div>
                              <div style={{fontSize:10,color:sc.text,opacity:0.6}}>{fmtTime(job.startTime)} · {fmtDur(job.durationMin)}</div>
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
  return(
    <div style={{padding:"12px 10px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#1A1A2E",marginBottom:12}}>📊 Récap — {fmtDateFR(dateKey)}</div>
      <div style={{background:"white",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#4A5568",marginBottom:10}}>Charge par machine</div>
        {stats.map(m=>(
          <div key={m.id} style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
              <span style={{fontWeight:600,color:"#2D3748"}}>{m.label} <span style={{fontSize:10,color:"#A0AEC0",fontWeight:400}}>({m.heads} tête{m.heads>1?"s":""})</span></span>
              <span style={{color:"#718096"}}>{fmtDur(m.totalMin)} · {m.mj.length} commande{m.mj.length!==1?"s":""}</span>
            </div>
            <div style={{height:7,background:"#F0EDE8",borderRadius:99,overflow:"hidden"}}><div style={{height:"100%",width:`${Math.min((m.totalMin/maxM)*100,100)}%`,background:m.color,borderRadius:99}}/></div>
          </div>
        ))}
      </div>
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{padding:"10px 14px",background:"#1A1A2E",color:"white",fontWeight:700,fontSize:12}}>Commandes du jour ({dayJobs.length})</div>
        {dayJobs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune commande</div>:(
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#FAFAF8"}}>{["Client","Machine","Horaire","Articles","Durée","Statut"].map(h=><th key={h} style={{padding:"7px 10px",fontSize:11,color:"#718096",fontWeight:600,textAlign:"left",borderBottom:"1px solid #F0EDE8"}}>{h}</th>)}</tr></thead>
            <tbody>{dayJobs.sort((a,b)=>a.startDate.localeCompare(b.startDate)||timeToMin(a.startTime)-timeToMin(b.startTime)).map((job,i)=>{
              const m=machines.find(m=>m.id===job.machineId),sc=STATUS_COLORS[job.status];
              return<tr key={job.key} style={{background:i%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"7px 10px",fontWeight:600,fontSize:12,borderBottom:"1px solid #F7F4F0"}}>{job.client}</td>
                <td style={{padding:"7px 10px",fontSize:11,borderBottom:"1px solid #F7F4F0"}}><span style={{background:m?.color+"20",color:m?.color,padding:"2px 6px",borderRadius:5,fontWeight:600,fontSize:10}}>{m?.label}</span></td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0"}}>{fmtTime(job.startTime)}→{fmtTime(job.endTime)}{job.startDate!==job.endDate&&<div style={{fontSize:9,color:"#6B9AC4"}}>multi-jours</div>}</td>
                <td style={{padding:"7px 10px",fontSize:11,borderBottom:"1px solid #F7F4F0"}}>
                  {job.qty>0?<div><div style={{fontWeight:600,color:"#2D3748"}}>{job.qty} pcs</div><div style={{fontSize:10,color:"#A0AEC0"}}>{job.unitTimeMin}min/u · {job.headsUsed}t</div></div>:<span style={{color:"#A0AEC0"}}>—</span>}
                </td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{fmtDur(job.durationMin)}</td>
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
function AdminPanel({allUsers,workingHours,machines,onClose}){
  const [tab,setTab]=useState("machines");
  const DN={0:"Dimanche",1:"Lundi",2:"Mardi",3:"Mercredi",4:"Jeudi",5:"Vendredi",6:"Samedi"};
  const AH=Array.from({length:15},(_,i)=>i+5);

  // ── Gestion machines ──────────────────────────────────────────────
  const saveMachine=async(id,patch)=>await update(ref(db,`settings/machines/${id}`),patch);
  const deleteMachine=async(id)=>await remove(ref(db,`settings/machines/${id}`));
  const addMachine=async()=>{
    const id="M"+Date.now();
    await set(ref(db,`settings/machines/${id}`),{label:"Nouvelle machine",type:"mono",color:MACHINE_COLORS[Math.floor(Math.random()*MACHINE_COLORS.length)],heads:1,active:true});
  };
  const initMachinesIfEmpty=async()=>{
    // Initialise Firebase avec les machines par défaut si pas encore configuré
    for(const m of DEFAULT_MACHINES){
      await set(ref(db,`settings/machines/${m.id}`),{label:m.label,type:m.type,color:m.color,heads:m.heads,active:m.active});
    }
  };

  const [machinesInDb,setMachinesInDb]=useState({});
  useEffect(()=>onValue(ref(db,"settings/machines"),(snap)=>setMachinesInDb(snap.val()||{})),[]);

  const allDbMachines=Object.entries(machinesInDb).map(([id,v])=>({id,...v})).sort((a,b)=>{
    if(a.type!==b.type)return a.type==="mono"?-1:1;
    return (a.label||"").localeCompare(b.label||"");
  });

  return(
    <div style={{position:"fixed",top:62,right:12,width:440,background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,overflow:"hidden",maxHeight:"85vh",display:"flex",flexDirection:"column"}}>
      <div style={{padding:"11px 14px",background:"#3D405B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>⚙️ Administration</span>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
      </div>
      <div style={{display:"flex",borderBottom:"1px solid #F0EDE8"}}>
        {[["machines","🔧 Machines"],["users","👥 Utilisateurs"],["horaires","🕐 Horaires"]].map(([t,l])=>(
          <button key={t} onClick={()=>setTab(t)} style={{flex:1,padding:"9px 4px",border:"none",background:tab===t?"white":"#FAFAF8",fontWeight:tab===t?700:400,fontSize:11,cursor:"pointer",color:tab===t?"#1A1A2E":"#718096",borderBottom:tab===t?"2px solid #E07A5F":"2px solid transparent"}}>{l}</button>
        ))}
      </div>
      <div style={{overflowY:"auto",flex:1,padding:14}}>

        {/* ── Machines ── */}
        {tab==="machines"&&(
          <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={{fontSize:11,color:"#718096"}}>Configurez le nom et le nombre de têtes de chaque machine.</div>
              <button onClick={addMachine} style={{background:"#1A1A2E",color:"white",border:"none",borderRadius:7,padding:"6px 10px",cursor:"pointer",fontSize:11,fontWeight:600,whiteSpace:"nowrap"}}>+ Ajouter</button>
            </div>
            {allDbMachines.length===0&&(
              <div style={{textAlign:"center",padding:16}}>
                <div style={{color:"#A0AEC0",fontSize:12,marginBottom:10}}>Aucune machine configurée.</div>
                <button onClick={initMachinesIfEmpty} style={{background:"#E07A5F",color:"white",border:"none",borderRadius:8,padding:"8px 16px",cursor:"pointer",fontSize:12,fontWeight:600}}>Initialiser avec les machines par défaut</button>
              </div>
            )}
            {allDbMachines.map(m=>(
              <div key={m.id} style={{marginBottom:10,padding:"10px 12px",background:"white",borderRadius:10,border:`1.5px solid ${m.active===false?"#EDE8E3":"#E2E8F0"}`}}>
                <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
                  {/* Couleur */}
                  <div style={{position:"relative"}}>
                    <div style={{width:20,height:20,borderRadius:"50%",background:m.color||"#999",cursor:"pointer",border:"2px solid #E2E8F0"}}/>
                    <input type="color" value={m.color||"#999999"} onChange={e=>saveMachine(m.id,{color:e.target.value})}
                      style={{position:"absolute",inset:0,opacity:0,cursor:"pointer",width:"100%",height:"100%"}}/>
                  </div>
                  {/* Nom */}
                  <input value={m.label||""} onChange={e=>saveMachine(m.id,{label:e.target.value})} placeholder="Nom de la machine"
                    style={{flex:1,padding:"6px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12}}/>
                  {/* Actif */}
                  <div onClick={()=>saveMachine(m.id,{active:m.active===false})} style={{width:34,height:18,borderRadius:99,background:m.active===false?"#CBD5E0":"#22C55E",cursor:"pointer",position:"relative",flexShrink:0}}>
                    <div style={{position:"absolute",top:2,left:m.active===false?2:18,width:14,height:14,borderRadius:"50%",background:"white",transition:"left .2s"}}/>
                  </div>
                  {/* Supprimer */}
                  <button onClick={()=>deleteMachine(m.id)} style={{background:"#FEE2E2",color:"#991B1B",border:"none",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:12,flexShrink:0}}>🗑</button>
                </div>
                <div style={{display:"flex",gap:8}}>
                  {/* Type */}
                  <div style={{flex:1}}>
                    <label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:2}}>Type</label>
                    <select value={m.type||"mono"} onChange={e=>saveMachine(m.id,{type:e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:11}}>
                      <option value="mono">Mono-tête</option>
                      <option value="multi">Multi-têtes</option>
                    </select>
                  </div>
                  {/* Nombre de têtes */}
                  <div style={{flex:1}}>
                    <label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:2}}>Nombre de têtes</label>
                    <input type="number" min={1} max={24} value={m.heads||1} onChange={e=>saveMachine(m.id,{heads:+e.target.value})}
                      style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:11,boxSizing:"border-box"}}/>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {/* ── Utilisateurs ── */}
        {tab==="users"&&<UsersTab allUsers={allUsers}/>}

        {/* ── Horaires ── */}
        {tab==="horaires"&&(
          <>
            <div style={{fontSize:11,color:"#718096",marginBottom:12,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}>Les jours non travaillés sont automatiquement sautés dans le calcul des tâches multi-jours.</div>
            {[1,2,3,4,5,6,0].map(di=>{
              const wh={...(DEFAULT_WH[di]||{start:8,end:18,active:false}),...(workingHours[di]||{})};
              return(
                <div key={di} style={{marginBottom:10,padding:"10px 12px",background:wh.active?"white":"#F7F4F0",borderRadius:10,border:`1.5px solid ${wh.active?"#E2E8F0":"#EDE8E3"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:wh.active?10:0}}>
                    <div style={{flex:1,fontWeight:700,fontSize:13,color:wh.active?"#1A1A2E":"#A0AEC0"}}>{DN[di]}</div>
                    <div onClick={()=>update(ref(db,`settings/workingHours/${di}`),{active:!wh.active})} style={{width:38,height:20,borderRadius:99,background:wh.active?"#22C55E":"#CBD5E0",cursor:"pointer",position:"relative",transition:"background .2s"}}>
                      <div style={{position:"absolute",top:2,left:wh.active?20:2,width:16,height:16,borderRadius:"50%",background:"white",transition:"left .2s",boxShadow:"0 1px 3px rgba(0,0,0,0.2)"}}/>
                    </div>
                    <span style={{fontSize:11,color:wh.active?"#22C55E":"#A0AEC0",fontWeight:600,minWidth:55}}>{wh.active?"Travaillé":"Repos"}</span>
                  </div>
                  {wh.active&&(
                    <>
                    {/* Horaires journée */}
                    <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:8}}>
                      <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Début</label>
                        <select value={wh.start} onChange={e=>update(ref(db,`settings/workingHours/${di}`),{start:+e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:11}}>
                          {AH.filter(h=>h<wh.end).map(h=><option key={h} value={h}>{h}h00</option>)}
                        </select>
                      </div>
                      <div style={{color:"#A0AEC0",fontSize:14,marginTop:14}}>→</div>
                      <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Fin</label>
                        <select value={wh.end} onChange={e=>update(ref(db,`settings/workingHours/${di}`),{end:+e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:11}}>
                          {AH.filter(h=>h>wh.start).map(h=><option key={h} value={h}>{h}h00</option>)}
                        </select>
                      </div>
                      <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#718096",display:"block",marginBottom:3}}>Total</label>
                        <div style={{padding:"5px 8px",borderRadius:7,background:"#F7F4F0",fontSize:11,color:"#4A5568",fontWeight:700,textAlign:"center"}}>
                          {wh.end-wh.start-(wh.breakActive&&wh.breakStart&&wh.breakEnd?Math.round((wh.breakEnd-wh.breakStart)/60):0)}h
                        </div>
                      </div>
                    </div>
                    {/* Pause méridienne */}
                    <div style={{background:"#FFF9F0",border:"1px solid #FED7AA",borderRadius:8,padding:"8px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:wh.breakActive?8:0}}>
                        <span style={{fontSize:11,color:"#92400E"}}>🍽</span>
                        <span style={{fontSize:11,fontWeight:600,color:"#92400E",flex:1}}>Pause méridienne</span>
                        <div onClick={()=>update(ref(db,`settings/workingHours/${di}`),{breakActive:!wh.breakActive})} style={{width:32,height:17,borderRadius:99,background:wh.breakActive?"#F59E0B":"#CBD5E0",cursor:"pointer",position:"relative",flexShrink:0}}>
                          <div style={{position:"absolute",top:2,left:wh.breakActive?17:2,width:13,height:13,borderRadius:"50%",background:"white",transition:"left .2s"}}/>
                        </div>
                        <span style={{fontSize:10,color:wh.breakActive?"#F59E0B":"#A0AEC0",fontWeight:600,minWidth:36}}>{wh.breakActive?"Active":"Off"}</span>
                      </div>
                      {wh.breakActive&&(
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#92400E",display:"block",marginBottom:3}}>Début pause</label>
                            <select value={wh.breakStart||720} onChange={e=>update(ref(db,`settings/workingHours/${di}`),{breakStart:+e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #FED7AA",fontSize:11}}>
                              {Array.from({length:24},(_,i)=>wh.start*60+i*15+60).filter(m=>m<(wh.end||18)*60).map(m=><option key={m} value={m}>{fmtTime(minToTime(m))}</option>)}
                            </select>
                          </div>
                          <div style={{color:"#FCD34D",fontSize:13,marginTop:14}}>→</div>
                          <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#92400E",display:"block",marginBottom:3}}>Fin pause</label>
                            <select value={wh.breakEnd||780} onChange={e=>update(ref(db,`settings/workingHours/${di}`),{breakEnd:+e.target.value})} style={{width:"100%",padding:"5px 8px",borderRadius:7,border:"1.5px solid #FED7AA",fontSize:11}}>
                              {Array.from({length:24},(_,i)=>(wh.breakStart||720)+i*15+15).filter(m=>m<=(wh.end||18)*60).map(m=><option key={m} value={m}>{fmtTime(minToTime(m))}</option>)}
                            </select>
                          </div>
                          <div style={{flex:1}}><label style={{fontSize:10,fontWeight:600,color:"#92400E",display:"block",marginBottom:3}}>Durée</label>
                            <div style={{padding:"5px 8px",borderRadius:7,background:"#FEF3C7",fontSize:11,color:"#92400E",fontWeight:700,textAlign:"center"}}>{fmtDur((wh.breakEnd||780)-(wh.breakStart||720))}</div>
                          </div>
                        </div>
                      )}
                    </div>
                    </>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Panneau Commandes Axonaut en attente ─────────────────────────────────────
function PendingOrdersPanel({orders,onImport,onAssign,onDiscard,loading,msg,onClose}){
  const fmtAmount=(a)=>a>0?new Intl.NumberFormat("fr-FR",{style:"currency",currency:"EUR",maximumFractionDigits:0}).format(a):"";
  const fmtImportDate=(ts)=>ts?new Date(ts).toLocaleDateString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}):"";

  return(
    <div style={{position:"fixed",top:62,right:12,width:420,background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,display:"flex",flexDirection:"column",maxHeight:"85vh",overflow:"hidden"}}>

      {/* Header */}
      <div style={{padding:"12px 16px",background:"#F59E0B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div>
          <div style={{fontWeight:700,fontSize:13}}>📥 Commandes Axonaut</div>
          <div style={{fontSize:10,opacity:0.85}}>{orders.length} commande{orders.length!==1?"s":""} en attente d'affectation</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={onImport} disabled={loading}
            style={{background:"rgba(255,255,255,0.2)",color:"white",border:"none",borderRadius:6,padding:"5px 10px",cursor:loading?"default":"pointer",fontSize:11,fontWeight:600}}>
            {loading?"⏳ Import…":"🔄 Synchroniser"}
          </button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.2)",color:"white",border:"none",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:13}}>×</button>
        </div>
      </div>

      {/* Message feedback */}
      {msg&&(
        <div style={{padding:"8px 14px",fontSize:11,fontWeight:600,
          background:msg.startsWith("✅")?"#D1FAE5":msg.startsWith("ℹ️")?"#EFF6FF":"#FEE2E2",
          color:msg.startsWith("✅")?"#065F46":msg.startsWith("ℹ️")?"#1D4ED8":"#991B1B",
          borderBottom:"1px solid #F0EDE8"}}>
          {msg}
        </div>
      )}

      {/* Instructions si vide */}
      {orders.length===0&&!loading&&(
        <div style={{padding:24,textAlign:"center",color:"#A0AEC0"}}>
          <div style={{fontSize:32,marginBottom:12}}>📦</div>
          <div style={{fontSize:13,fontWeight:600,color:"#4A5568",marginBottom:6}}>Aucune commande en attente</div>
          <div style={{fontSize:12,marginBottom:16}}>Cliquez sur <strong>"🔄 Synchroniser"</strong> pour importer les commandes gagnées depuis Axonaut.</div>
          <div style={{fontSize:11,color:"#CBD5E0",background:"#F7F4F0",borderRadius:8,padding:"8px 12px",textAlign:"left"}}>
            <div style={{fontWeight:600,marginBottom:4}}>⚠️ Vérifiez que :</div>
            <div>• La variable <code>AXONAUT_API_KEY</code> est configurée dans Vercel</div>
            <div>• Le fichier <code>api/axonaut.js</code> est bien dans votre dépôt GitHub</div>
          </div>
        </div>
      )}

      {/* Liste des commandes */}
      <div style={{overflowY:"auto",flex:1}}>
        {orders.map(order=>(
          <div key={order.key} style={{padding:"12px 14px",borderBottom:"1px solid #F7F4F0"}}>
            <div style={{display:"flex",alignItems:"flex-start",gap:10}}>
              {/* Infos commande */}
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                  <div style={{fontSize:13,fontWeight:700,color:"#1A1A2E",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{order.client}</div>
                  {order.amount>0&&<span style={{fontSize:11,fontWeight:700,color:"#F59E0B",flexShrink:0}}>{fmtAmount(order.amount)}</span>}
                </div>
                {order.description&&<div style={{fontSize:12,color:"#718096",marginBottom:3,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{order.description}</div>}
                <div style={{display:"flex",gap:8,fontSize:10,color:"#A0AEC0",flexWrap:"wrap"}}>
                  {order.reference&&<span>Réf. {order.reference}</span>}
                  {order.createdAt&&<span>Créée le {new Date(order.createdAt).toLocaleDateString("fr-FR")}</span>}
                  <span>Importée {fmtImportDate(order.importedAt)}</span>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div style={{display:"flex",gap:6,marginTop:10}}>
              <button onClick={()=>onAssign(order)}
                style={{flex:3,padding:"8px",borderRadius:8,border:"none",background:"#1A1A2E",color:"white",fontWeight:700,cursor:"pointer",fontSize:12}}>
                📅 Affecter à une machine
              </button>
              <button onClick={()=>onDiscard(order)}
                title="Ignorer cette commande"
                style={{flex:1,padding:"8px",borderRadius:8,border:"1.5px solid #E2E8F0",background:"white",color:"#718096",fontWeight:600,cursor:"pointer",fontSize:12}}>
                🗑 Ignorer
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Footer aide */}
      <div style={{padding:"8px 14px",borderTop:"1px solid #F0EDE8",background:"#FAFAF8",fontSize:10,color:"#A0AEC0",textAlign:"center"}}>
        Seules les commandes "Gagnées/Acceptées" dans Axonaut sont importées
      </div>
    </div>
  );
}

// ─── Onglet Utilisateurs ──────────────────────────────────────────────────────
function UsersTab({allUsers}){
  const [showForm, setShowForm] = useState(false);
  const [newUser,  setNewUser]  = useState({name:"",email:"",password:"",role:"operateur"});
  const [creating, setCreating] = useState(false);
  const [err,      setErr]      = useState("");
  const [success,  setSuccess]  = useState("");

  const createUser = async () => {
    if(!newUser.email.trim()||!newUser.password||newUser.password.length<6){
      setErr("Email requis et mot de passe minimum 6 caractères."); return;
    }
    setCreating(true); setErr(""); setSuccess("");
    try {
      // Création via l'API REST Firebase (ne déconnecte pas l'admin)
      const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;
      const res = await fetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
        { method:"POST", headers:{"Content-Type":"application/json"},
          body: JSON.stringify({email:newUser.email.trim(), password:newUser.password, returnSecureToken:false}) }
      );
      const data = await res.json();
      if(!res.ok) throw new Error(data.error?.message||"Erreur création");
      // Créer le profil dans la base
      await set(ref(db,`users/${data.localId}`),{
        email: newUser.email.trim(),
        name:  newUser.name.trim()||newUser.email.split("@")[0],
        role:  newUser.role,
      });
      setSuccess(`✅ Utilisateur "${newUser.email}" créé avec le rôle ${ROLE_LABELS[newUser.role]}.`);
      setNewUser({name:"",email:"",password:"",role:"operateur"});
      setShowForm(false);
    } catch(e){
      const msg = e.message;
      if(msg.includes("EMAIL_EXISTS"))setErr("Cet email est déjà utilisé.");
      else if(msg.includes("INVALID_EMAIL"))setErr("Format d'email invalide.");
      else if(msg.includes("WEAK_PASSWORD"))setErr("Mot de passe trop faible (min. 6 caractères).");
      else setErr("Erreur : "+msg);
    } finally { setCreating(false); }
  };

  const deleteUser = async (uid, u) => {
    if(!window.confirm(`Supprimer "${u.name||u.email}" ?
(Supprime le profil mais pas le compte Firebase Auth)`))return;
    await remove(ref(db,`users/${uid}`));
  };

  return(
    <>
      {/* Résumé des rôles */}
      <div style={{fontSize:11,color:"#718096",marginBottom:12,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}>
        <strong>Admin</strong> : tout + notifs · <strong>Opérateur</strong> : ajouter/modifier · <strong>Lecteur</strong> : consulter
      </div>

      {/* Feedback */}
      {err&&<div style={{background:"#FEE2E2",color:"#991B1B",borderRadius:8,padding:"8px 10px",fontSize:11,marginBottom:10}}>{err}</div>}
      {success&&<div style={{background:"#D1FAE5",color:"#065F46",borderRadius:8,padding:"8px 10px",fontSize:11,marginBottom:10}}>{success}</div>}

      {/* Liste des utilisateurs */}
      {Object.entries(allUsers).map(([uid,u])=>(
        <div key={uid} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 0",borderBottom:"1px solid #F7F4F0"}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:12,fontWeight:600,color:"#2D3748",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||u.email}</div>
            <div style={{fontSize:10,color:"#A0AEC0"}}>{u.email}</div>
          </div>
          <select value={u.role||"lecteur"} onChange={e=>update(ref(db,`users/${uid}`),{role:e.target.value})}
            style={{padding:"5px 7px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:11,cursor:"pointer",fontWeight:600,
              background:u.role==="admin"?"#FEFCE8":u.role==="operateur"?"#F0FDF4":"#F9FAFB",
              color:u.role==="admin"?"#854D0E":u.role==="operateur"?"#166534":"#4B5563"}}>
            <option value="admin">Administrateur</option>
            <option value="operateur">Opérateur</option>
            <option value="lecteur">Lecteur</option>
          </select>
          <button onClick={()=>deleteUser(uid,u)} title="Supprimer le profil"
            style={{background:"#FEE2E2",color:"#991B1B",border:"none",borderRadius:6,width:24,height:24,cursor:"pointer",fontSize:12,flexShrink:0}}>🗑</button>
        </div>
      ))}

      {/* Formulaire de création */}
      {showForm?(
        <div style={{marginTop:14,background:"#F7F9FC",borderRadius:10,padding:14,border:"1.5px solid #E2E8F0"}}>
          <div style={{fontSize:12,fontWeight:700,color:"#1A1A2E",marginBottom:12}}>➕ Nouvel utilisateur</div>
          <div style={{marginBottom:9}}>
            <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Prénom / Nom</label>
            <input value={newUser.name} onChange={e=>setNewUser(u=>({...u,name:e.target.value}))} placeholder="Ex: Marie Dupont"
              style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:9}}>
            <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Email *</label>
            <input type="email" value={newUser.email} onChange={e=>setNewUser(u=>({...u,email:e.target.value}))} placeholder="prenom@atelier.fr"
              style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:9}}>
            <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Mot de passe temporaire *</label>
            <input type="password" value={newUser.password} onChange={e=>setNewUser(u=>({...u,password:e.target.value}))} placeholder="Min. 6 caractères"
              style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,boxSizing:"border-box"}}/>
          </div>
          <div style={{marginBottom:14}}>
            <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Rôle</label>
            <select value={newUser.role} onChange={e=>setNewUser(u=>({...u,role:e.target.value}))}
              style={{width:"100%",padding:"7px 9px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12}}>
              <option value="admin">Administrateur</option>
              <option value="operateur">Opérateur</option>
              <option value="lecteur">Lecteur</option>
            </select>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>{setShowForm(false);setErr("");setNewUser({name:"",email:"",password:"",role:"operateur"});}}
              style={{flex:1,padding:"8px",borderRadius:7,border:"1.5px solid #E2E8F0",background:"white",fontWeight:600,cursor:"pointer",fontSize:12}}>Annuler</button>
            <button onClick={createUser} disabled={creating||!newUser.email||!newUser.password}
              style={{flex:2,padding:"8px",borderRadius:7,border:"none",background:(creating||!newUser.email||!newUser.password)?"#CBD5E0":"#1A1A2E",color:"white",fontWeight:700,cursor:(creating||!newUser.email||!newUser.password)?"default":"pointer",fontSize:12}}>
              {creating?"⏳ Création…":"Créer l'utilisateur"}
            </button>
          </div>
        </div>
      ):(
        <button onClick={()=>{setShowForm(true);setErr("");setSuccess("");}}
          style={{width:"100%",marginTop:12,padding:"9px",borderRadius:8,border:"1.5px dashed #CBD5E0",background:"white",color:"#4A5568",fontWeight:600,cursor:"pointer",fontSize:12}}>
          ➕ Créer un nouvel utilisateur
        </button>
      )}
    </>
  );
}

// ─── Notifs ────────────────────────────────────────────────────────────────────
function NotifPanel({notifs,onMarkRead,onDelete,onDeleteAll,onClose}){
  return(
    <div style={{position:"fixed",top:62,right:12,width:390,maxHeight:"72vh",background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 14px",background:"#1A1A2E",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>🔔 Modifications ({notifs.length})</span>
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <button onClick={onMarkRead} title="Marquer tout comme lu" style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11}}>✓ Tout lire</button>
          <button onClick={onDeleteAll} title="Supprimer toutes les notifications" style={{background:"rgba(239,68,68,0.3)",color:"white",border:"none",borderRadius:6,padding:"3px 8px",cursor:"pointer",fontSize:11}}>🗑 Tout supprimer</button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
        </div>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {notifs.length===0?<div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune notification</div>
        :notifs.map(n=>{const icon=n.action==="ajout"?"➕":n.action==="suppression"?"🗑":n.action==="deplacement"?"↔️":"✏️";return(
          <div key={n.key} style={{padding:"9px 13px",borderBottom:"1px solid #F7F4F0",background:n.read?"white":"#EBF4FF",display:"flex",gap:9,alignItems:"flex-start"}}>
            <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
            <div style={{flex:1,minWidth:0}}><div style={{fontSize:12,color:"#2D3748",lineHeight:1.4}}>{n.details}</div><div style={{fontSize:10,color:"#A0AEC0",marginTop:2}}>{ROLE_LABELS[n.role]||n.role} <strong>{n.user}</strong> · {fmtDT(n.ts)}</div></div>
            {!n.read&&<div style={{width:7,height:7,borderRadius:"50%",background:"#E07A5F",flexShrink:0,marginTop:4}}/>}
            <button onClick={()=>onDelete(n.key)} style={{background:"none",border:"none",cursor:"pointer",color:"#CBD5E0",fontSize:13,flexShrink:0}}>×</button>
          </div>
        );})}
      </div>
    </div>
  );
}

// ─── Login & Loader ────────────────────────────────────────────────────────────
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
