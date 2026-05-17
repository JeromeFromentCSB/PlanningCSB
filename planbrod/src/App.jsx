import { useState, useEffect, useCallback } from "react";
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

const HOUR_START = 7;
const HOUR_END   = 18;
const HOURS      = Array.from({ length: HOUR_END - HOUR_START }, (_, i) => HOUR_START + i);
const DAYS_FR    = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
const MONTHS_FR  = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

const STATUS_COLORS = {
  "En attente": { bg:"#FFF3CD", text:"#856404", border:"#FFDA6A" },
  "En cours":   { bg:"#D1E7DD", text:"#0F5132", border:"#A3CFBB" },
  "Termine":    { bg:"#E2E3E5", text:"#41464B", border:"#BCBEBF" },
  "Urgent":     { bg:"#F8D7DA", text:"#842029", border:"#F1AEB5" },
};
const STATUS_LABELS = { "En attente":"En attente","En cours":"En cours","Termine":"Terminé","Urgent":"Urgent" };
const JOB_COLORS    = ["#E07A5F","#3D405B","#81B29A","#F2CC8F","#6B9AC4","#D4A5A5","#9BB7D4","#C3B1E1","#A8D5BA","#F4A261"];

const ROLE_LABELS = { admin:"Administrateur", operateur:"Opérateur", lecteur:"Lecteur" };
const CAN = {
  admin:     { add:true,  edit:true,  delete:true,  manage:true  },
  operateur: { add:true,  edit:true,  delete:false, manage:false },
  lecteur:   { add:false, edit:false, delete:false, manage:false },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function dateToKey(d)    { return d.toISOString().slice(0,10); }
function todayKey()      { return dateToKey(new Date()); }
function offsetDate(key, n) {
  const d = new Date(key + "T12:00:00");
  d.setDate(d.getDate() + n);
  return dateToKey(d);
}
function formatDateFR(key) {
  const d = new Date(key + "T12:00:00");
  return `${DAYS_FR[d.getDay()]} ${d.getDate()} ${MONTHS_FR[d.getMonth()]} ${d.getFullYear()}`;
}
function isToday(key)    { return key === todayKey(); }
function randColor()     { return JOB_COLORS[Math.floor(Math.random() * JOB_COLORS.length)]; }
function fmtDateTime(ts) { return new Date(ts).toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}); }
function hLabel(h)       { return `${h}h`; }

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [authUser, setAuthUser]       = useState(undefined);
  const [userProfile, setUserProfile] = useState(null);
  const [jobs, setJobs]               = useState({});
  const [notifs, setNotifs]           = useState({});
  const [allUsers, setAllUsers]       = useState({});
  const [dateKey, setDateKey]         = useState(todayKey());
  const [modal, setModal]             = useState(null);
  const [form, setForm]               = useState({});
  const [view, setView]               = useState("planning");
  const [showNotifs, setShowNotifs]   = useState(false);
  const [showAdmin, setShowAdmin]     = useState(false);
  const [draggingId, setDraggingId]   = useState(null);
  const [dragOver, setDragOver]       = useState(null);
  const [loginErr, setLoginErr]       = useState("");

  // ── Auth ────────────────────────────────────────────────────────
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setAuthUser(u || null);
      if (!u) { setUserProfile(null); return; }
      onValue(ref(db, `users/${u.uid}`), (snap) => {
        const data = snap.val();
        if (data) setUserProfile(data);
        else {
          const profile = { email: u.email, name: u.email.split("@")[0], role:"operateur" };
          update(ref(db, `users/${u.uid}`), profile);
          setUserProfile(profile);
        }
      });
    });
  }, []);

  // ── Jobs ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser) return;
    return onValue(ref(db, `days/${dateKey}/jobs`), (snap) => setJobs(snap.val() || {}));
  }, [dateKey, authUser]);

  // ── Notifs ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser || userProfile?.role !== "admin") return;
    return onValue(ref(db, "notifications"), (snap) => setNotifs(snap.val() || {}));
  }, [authUser, userProfile?.role]);

  // ── Users ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!authUser || userProfile?.role !== "admin") return;
    return onValue(ref(db, "users"), (snap) => setAllUsers(snap.val() || {}));
  }, [authUser, userProfile?.role]);

  // ── Log ────────────────────────────────────────────────────────
  const logChange = useCallback(async (action, details) => {
    if (!authUser || !userProfile) return;
    await push(ref(db, "notifications"), {
      ts: Date.now(), action, details,
      user: userProfile.name || userProfile.email,
      role: userProfile.role, read: false,
    });
  }, [authUser, userProfile]);

  // ── CRUD ────────────────────────────────────────────────────────
  const role = userProfile?.role || "lecteur";
  const can  = CAN[role] || CAN.lecteur;

  const openAdd = (machineId, startHour) => {
    if (!can.add) return;
    setForm({ machineId, startHour, duration:1, client:"", description:"", status:"En attente", couleur:randColor() });
    setModal({ type:"add" });
  };
  const openEdit = (job) => {
    if (!can.edit && !can.delete) return;
    setForm({ ...job }); setModal({ type:"edit" });
  };

  const saveJob = async () => {
    if (!form.client.trim()) return;
    const { key, ...data } = form;
    const m = MACHINES.find(x => x.id === data.machineId);
    if (modal.type === "add") {
      await push(ref(db, `days/${dateKey}/jobs`), data);
      await logChange("ajout", `Ajout "${data.client}" (${data.description||"–"}) sur ${m?.label}, ${hLabel(data.startHour)} → ${hLabel(data.startHour+data.duration)}`);
    } else {
      await update(ref(db, `days/${dateKey}/jobs/${key}`), data);
      await logChange("modification", `Modif "${data.client}" → ${m?.label}, ${hLabel(data.startHour)}-${hLabel(data.startHour+data.duration)}, ${STATUS_LABELS[data.status]}`);
    }
    setModal(null);
  };

  const deleteJob = async (key, job) => {
    if (!can.delete) return;
    const m = MACHINES.find(x => x.id === job.machineId);
    await remove(ref(db, `days/${dateKey}/jobs/${key}`));
    await logChange("suppression", `Suppression "${job.client}" de ${m?.label}`);
    setModal(null);
  };

  // ── Drag & drop ─────────────────────────────────────────────────
  const onDragStart = (e, job) => {
    if (!can.edit) return;
    setDraggingId(job.key);
    e.dataTransfer.effectAllowed = "move";
  };
  const onDragEnd   = () => { setDraggingId(null); setDragOver(null); };
  const onDragOver  = (e, machineId, startHour) => {
    e.preventDefault();
    if (!can.edit) return;
    setDragOver({ machineId, startHour });
  };
  const onDragLeave = () => setDragOver(null);
  const onDrop      = async (e, machineId, startHour) => {
    e.preventDefault();
    if (!draggingId || !can.edit) return;
    const job = jobs[draggingId];
    if (!job) return;
    const fromM = MACHINES.find(x => x.id === job.machineId);
    const toM   = MACHINES.find(x => x.id === machineId);
    await update(ref(db, `days/${dateKey}/jobs/${draggingId}`), { machineId, startHour });
    if (fromM?.id !== toM?.id || job.startHour !== startHour)
      await logChange("deplacement", `Déplacement "${job.client}" : ${fromM?.label} ${hLabel(job.startHour)} → ${toM?.label} ${hLabel(startHour)}`);
    setDraggingId(null); setDragOver(null);
  };

  const markAllRead = async () => {
    const upd = {};
    Object.keys(notifs).forEach(k => { upd[`notifications/${k}/read`] = true; });
    await update(ref(db), upd);
  };
  const deleteNotif = async (k) => remove(ref(db, `notifications/${k}`));

  const jobsList       = Object.entries(jobs).map(([key,val]) => ({...val, key}));
  const notifsList     = Object.entries(notifs).map(([key,val]) => ({...val, key})).sort((a,b) => b.ts - a.ts);
  const unreadCount    = notifsList.filter(n => !n.read).length;
  const monoMachines   = MACHINES.filter(m => m.type === "mono");
  const multiMachines  = MACHINES.filter(m => m.type === "multi");
  const dragProps      = { draggingId, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop, can };

  if (authUser === undefined) return <Loader />;
  if (!authUser) return (
    <LoginScreen error={loginErr} onLogin={async (email, pass) => {
      try { setLoginErr(""); await signInWithEmailAndPassword(auth, email, pass); }
      catch { setLoginErr("Email ou mot de passe incorrect."); }
    }} />
  );

  return (
    <div style={{fontFamily:"'Segoe UI',sans-serif",background:"#F7F4F0",minHeight:"100vh"}}>

      {/* ── Header ── */}
      <div style={{background:"#1A1A2E",color:"white",padding:"12px 18px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 12px rgba(0,0,0,0.2)"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>🧵</span>
          <div>
            <div style={{fontSize:17,fontWeight:700}}>PlanBrod</div>
            <div style={{fontSize:10,color:"#A0AEC0"}}>
              {userProfile?.name || userProfile?.email} · <span style={{color:role==="admin"?"#F2CC8F":role==="operateur"?"#81B29A":"#A0AEC0"}}>{ROLE_LABELS[role]}</span>
            </div>
          </div>
        </div>

        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          {/* Navigation jour */}
          <button onClick={() => setDateKey(k => offsetDate(k,-1))} style={navBtn}>‹</button>
          <div style={{textAlign:"center",minWidth:160}}>
            <div style={{color:"white",fontSize:12,fontWeight:600}}>{formatDateFR(dateKey)}</div>
            {isToday(dateKey) && <div style={{fontSize:10,color:"#81B29A",fontWeight:600}}>Aujourd'hui</div>}
          </div>
          <button onClick={() => setDateKey(k => offsetDate(k,+1))} style={navBtn}>›</button>
          <button onClick={() => setDateKey(todayKey())} style={{...navBtn,fontSize:10,width:"auto",padding:"0 8px"}}>Auj.</button>

          <div style={{width:1,height:22,background:"rgba(255,255,255,0.2)",margin:"0 2px"}}/>

          {["planning","recap"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{background:view===v?"#E07A5F":"rgba(255,255,255,0.1)",color:"white",border:"none",borderRadius:7,padding:"6px 12px",fontWeight:600,cursor:"pointer",fontSize:11}}>
              {v==="planning"?"📅 Planning":"📊 Récap"}
            </button>
          ))}

          {role === "admin" && (
            <button onClick={() => { setShowNotifs(v=>!v); setShowAdmin(false); }} style={{...iconBtn,position:"relative"}}>
              🔔
              {unreadCount > 0 && <span style={{position:"absolute",top:-4,right:-4,background:"#E07A5F",color:"white",borderRadius:99,fontSize:9,fontWeight:800,minWidth:16,height:16,display:"flex",alignItems:"center",justifyContent:"center"}}>{unreadCount}</span>}
            </button>
          )}
          {role === "admin" && (
            <button onClick={() => { setShowAdmin(v=>!v); setShowNotifs(false); }} style={iconBtn} title="Utilisateurs">⚙️</button>
          )}
          <button onClick={() => signOut(auth)} style={{...iconBtn,opacity:0.7}} title="Déconnexion">🚪</button>
        </div>
      </div>

      {showNotifs && role==="admin" && <NotifPanel notifs={notifsList} onMarkRead={markAllRead} onDelete={deleteNotif} onClose={() => setShowNotifs(false)} />}
      {showAdmin  && role==="admin" && <AdminPanel allUsers={allUsers} onClose={() => setShowAdmin(false)} />}

      {view === "recap"
        ? <RecapView jobs={jobsList} machines={MACHINES} dateKey={dateKey} />
        : <PlanningView
            monoMachines={monoMachines} multiMachines={multiMachines}
            jobs={jobsList} openAdd={openAdd} openEdit={openEdit}
            dateKey={dateKey} can={can}
            {...dragProps}
          />
      }

      {/* ── Modal ── */}
      {modal && (
        <div onClick={() => setModal(null)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div onClick={e => e.stopPropagation()} style={{background:"white",borderRadius:16,padding:24,width:380,boxShadow:"0 20px 60px rgba(0,0,0,0.25)"}}>
            <div style={{fontSize:15,fontWeight:700,marginBottom:14,color:"#1A1A2E"}}>
              {modal.type==="add" ? "➕ Nouvelle commande" : "✏️ Modifier"}
            </div>

            {modal.type==="edit" && !can.delete && (
              <div style={{background:"#FFF3CD",border:"1px solid #FFDA6A",borderRadius:8,padding:"7px 10px",fontSize:11,color:"#856404",marginBottom:12}}>
                ℹ️ Votre rôle ne permet pas la suppression.
              </div>
            )}

            {[{label:"Client *",key:"client",ph:"Nom du client"},{label:"Description",key:"description",ph:"Ex: Polos x30"}].map(({label,key,ph}) => (
              <div key={key} style={{marginBottom:10}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>{label}</label>
                <input value={form[key]||""} onChange={e => setForm(f => ({...f,[key]:e.target.value}))} placeholder={ph}
                  style={{width:"100%",padding:"8px 10px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}} />
              </div>
            ))}

            <div style={{display:"flex",gap:10,marginBottom:10}}>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Machine</label>
                <select value={form.machineId} onChange={e => setForm(f => ({...f,machineId:e.target.value}))} style={selStyle}>
                  {MACHINES.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Statut</label>
                <select value={form.status} onChange={e => setForm(f => ({...f,status:e.target.value}))} style={selStyle}>
                  {Object.entries(STATUS_LABELS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>

            <div style={{display:"flex",gap:10,marginBottom:18}}>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Heure de début</label>
                <select value={form.startHour} onChange={e => setForm(f => ({...f,startHour:+e.target.value}))} style={selStyle}>
                  {HOURS.map(h => <option key={h} value={h}>{hLabel(h)}</option>)}
                </select>
              </div>
              <div style={{flex:1}}>
                <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Durée</label>
                <select value={form.duration} onChange={e => setForm(f => ({...f,duration:+e.target.value}))} style={selStyle}>
                  {[1,2,3,4,5,6,7,8].filter(d => (form.startHour||HOUR_START)+d <= HOUR_END).map(d => (
                    <option key={d} value={d}>{d}h (→ {hLabel((form.startHour||HOUR_START)+d)})</option>
                  ))}
                </select>
              </div>
            </div>

            <div style={{display:"flex",gap:8}}>
              {modal.type==="edit" && can.delete && (
                <button onClick={() => deleteJob(form.key, form)} style={{padding:"9px 13px",borderRadius:8,border:"none",background:"#FEE2E2",color:"#991B1B",fontWeight:600,cursor:"pointer"}}>🗑</button>
              )}
              <button onClick={() => setModal(null)} style={{flex:1,padding:"9px",borderRadius:8,border:"1.5px solid #E2E8F0",background:"white",fontWeight:600,cursor:"pointer",fontSize:12}}>Annuler</button>
              <button onClick={saveJob} disabled={!form.client?.trim()} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:form.client?.trim()?"#1A1A2E":"#CBD5E0",color:"white",fontWeight:700,cursor:form.client?.trim()?"pointer":"default",fontSize:12}}>
                {modal.type==="add" ? "Ajouter" : "Enregistrer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Planning View ─────────────────────────────────────────────────────────────
function PlanningView({ monoMachines, multiMachines, jobs, openAdd, openEdit, dateKey, can, ...dragProps }) {
  const byStatus     = Object.keys(STATUS_COLORS).reduce((acc,s) => { acc[s]=jobs.filter(j=>j.status===s).length; return acc; }, {});
  const getJobsForM  = (machineId) => jobs.filter(j => j.machineId === machineId);

  return (
    <div style={{padding:"14px 10px"}}>
      {/* Stats */}
      <div style={{display:"flex",gap:7,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
        {[{label:"Total",value:jobs.length,icon:"📋",bg:"#1A1A2E",color:"white"},
          ...Object.entries(byStatus).map(([s,n]) => ({label:STATUS_LABELS[s],value:n,icon:s==="En cours"?"⚙️":s==="Urgent"?"🚨":s==="Termine"?"✅":"⏳",bg:STATUS_COLORS[s].bg,color:STATUS_COLORS[s].text}))
        ].map(({label,value,icon,bg,color}) => (
          <div key={label} style={{background:bg,color,borderRadius:9,padding:"6px 11px",display:"flex",alignItems:"center",gap:5,fontWeight:600,fontSize:11,boxShadow:"0 1px 4px rgba(0,0,0,0.07)"}}>
            <span>{icon}</span><span style={{fontSize:14,fontWeight:800}}>{value}</span><span style={{opacity:0.8}}>{label}</span>
          </div>
        ))}
        {can.edit && <div style={{marginLeft:"auto",fontSize:11,color:"#A0AEC0",fontStyle:"italic"}}>✋ Glissez pour déplacer</div>}
        {!can.add  && <div style={{marginLeft:"auto",fontSize:11,color:"#A0AEC0",fontStyle:"italic"}}>👁 Lecture seule</div>}
      </div>

      {/* Grille */}
      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <HourGrid label="🪡 Mono-Têtes" machines={monoMachines} getJobsForM={getJobsForM} openAdd={openAdd} openEdit={openEdit} headerColor="#E07A5F" can={can} {...dragProps} />
        <div style={{height:1,background:"#F0EDE8"}} />
        <HourGrid label="🎛 Multi-Têtes" machines={multiMachines} getJobsForM={getJobsForM} openAdd={openAdd} openEdit={openEdit} headerColor="#3D405B" can={can} {...dragProps} />
      </div>
      <div style={{textAlign:"center",marginTop:8,fontSize:11,color:"#A0AEC0"}}>
        Clic sur créneau vide = ajouter · Clic sur tâche = modifier · Glisser = déplacer
      </div>
    </div>
  );
}

// ─── Grille horaire ────────────────────────────────────────────────────────────
function HourGrid({ label, machines, getJobsForM, openAdd, openEdit, headerColor, can, draggingId, dragOver, onDragStart, onDragEnd, onDragOver, onDragLeave, onDrop }) {
  const isDragging = draggingId != null;
  const CELL_W = 64;

  return (
    <div>
      <div style={{padding:"10px 14px",background:headerColor,color:"white",fontWeight:700,fontSize:12}}>{label}</div>
      <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",tableLayout:"fixed",minWidth: 90 + HOURS.length * CELL_W}}>
          {/* En-têtes heures */}
          <thead>
            <tr>
              <th style={{width:88,padding:"7px 10px",textAlign:"left",fontSize:11,color:"#718096",fontWeight:600,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",position:"sticky",left:0,zIndex:2}}>Machine</th>
              {HOURS.map(h => (
                <th key={h} style={{width:CELL_W,padding:"7px 4px",fontSize:11,color:"#718096",fontWeight:600,background:"#FAFAF8",borderBottom:"1px solid #F0EDE8",textAlign:"center",borderLeft:"1px solid #F0EDE8"}}>
                  {hLabel(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {machines.map((machine, mi) => {
              const machineJobs = getJobsForM(machine.id);
              // Calculer quelles heures sont occupées
              const occupied = new Set();
              machineJobs.forEach(j => {
                for (let h = j.startHour + 1; h < j.startHour + j.duration; h++) occupied.add(h);
              });

              return (
                <tr key={machine.id} style={{background:mi%2===0?"white":"#FDFCFB"}}>
                  {/* Label machine */}
                  <td style={{padding:"7px 10px",fontWeight:600,fontSize:11,color:"#2D3748",borderBottom:"1px solid #F7F4F0",whiteSpace:"nowrap",position:"sticky",left:0,background:mi%2===0?"white":"#FDFCFB",zIndex:1}}>
                    <div style={{display:"flex",alignItems:"center",gap:5}}>
                      <div style={{width:7,height:7,borderRadius:"50%",background:machine.color}}/>{machine.label}
                    </div>
                  </td>

                  {/* Cellules horaires */}
                  {HOURS.map(h => {
                    if (occupied.has(h)) return null; // absorbée par un colspan

                    const job     = machineJobs.find(j => j.startHour === h);
                    const isOver  = dragOver?.machineId === machine.id && dragOver?.startHour === h;
                    const span    = job ? Math.min(job.duration, HOUR_END - h) : 1;
                    const isGhost = job?.key === draggingId;
                    const sc      = job ? STATUS_COLORS[job.status] : null;

                    return (
                      <td key={h} colSpan={span}
                        onClick={() => { if (!isDragging && !job && can.add) openAdd(machine.id, h); }}
                        onDragOver={e  => onDragOver(e, machine.id, h)}
                        onDragLeave={onDragLeave}
                        onDrop={e      => onDrop(e, machine.id, h)}
                        style={{
                          padding: job ? 3 : 4,
                          verticalAlign:"top",
                          borderBottom:"1px solid #F7F4F0",
                          borderLeft:"1px solid #F0EDE8",
                          cursor: isDragging && can.edit ? "copy" : !job && can.add ? "cell" : "default",
                          background: isOver ? "#EBF4FF" : "transparent",
                          outline: isOver ? "2px dashed #6B9AC4" : "none",
                          outlineOffset: -2,
                          transition:"background .1s",
                          minWidth: CELL_W * span,
                          height: 52,
                        }}
                      >
                        {job ? (
                          <div
                            draggable={can.edit}
                            onDragStart={e => onDragStart(e, job)}
                            onDragEnd={onDragEnd}
                            onClick={e => { e.stopPropagation(); if (!isDragging) openEdit(job); }}
                            title={`${job.client}${job.description?" – "+job.description:""}\n${hLabel(job.startHour)} → ${hLabel(job.startHour+job.duration)}`}
                            style={{
                              height:"100%", background:sc.bg,
                              border:`1.5px solid ${sc.border}`,
                              borderLeft:`3px solid ${job.couleur}`,
                              borderRadius:6, padding:"4px 7px",
                              cursor: can.edit ? (isDragging?"grabbing":"grab") : "default",
                              opacity: isGhost ? 0.3 : 1,
                              overflow:"hidden",
                              transition:"opacity .15s,box-shadow .1s",
                              userSelect:"none",
                            }}
                            onMouseEnter={e => { if(!isDragging&&can.edit) e.currentTarget.style.boxShadow="0 3px 10px rgba(0,0,0,0.14)"; }}
                            onMouseLeave={e => { e.currentTarget.style.boxShadow="none"; }}
                          >
                            <div style={{fontSize:11,fontWeight:700,color:sc.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.client}</div>
                            {job.description && span > 1 && <div style={{fontSize:10,color:sc.text,opacity:0.75,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.description}</div>}
                            <div style={{fontSize:10,color:sc.text,opacity:0.55,marginTop:1}}>{hLabel(job.startHour)}→{hLabel(job.startHour+job.duration)} · {STATUS_LABELS[job.status]}</div>
                          </div>
                        ) : isOver ? (
                          <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"#6B9AC4",fontSize:11,fontWeight:700,pointerEvents:"none"}}>↓</div>
                        ) : can.add ? (
                          <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",color:"#E8E8E8",fontSize:16,pointerEvents:"none"}}>+</div>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Récap View ────────────────────────────────────────────────────────────────
function RecapView({ jobs, machines, dateKey }) {
  const machineStats = machines.map(m => {
    const mJobs = jobs.filter(j => j.machineId === m.id);
    const totalH = mJobs.reduce((a,j) => a+(j.duration||1), 0);
    return {...m, mJobs, totalH};
  });
  const maxH = Math.max(...machineStats.map(m=>m.totalH), 1);

  return (
    <div style={{padding:"14px 10px"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#1A1A2E",marginBottom:12}}>📊 Récap — {formatDateFR(dateKey)}</div>

      <div style={{background:"white",borderRadius:14,padding:16,marginBottom:12,boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{fontSize:12,fontWeight:700,color:"#4A5568",marginBottom:10}}>Charge par machine</div>
        {machineStats.map(m => (
          <div key={m.id} style={{marginBottom:9}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
              <span style={{fontWeight:600,color:"#2D3748"}}>{m.label}</span>
              <span style={{color:"#718096"}}>{m.totalH}h · {m.mJobs.length} commande{m.mJobs.length!==1?"s":""}</span>
            </div>
            <div style={{height:7,background:"#F0EDE8",borderRadius:99,overflow:"hidden"}}>
              <div style={{height:"100%",width:`${Math.min((m.totalH/maxH)*100,100)}%`,background:m.color,borderRadius:99}}/>
            </div>
          </div>
        ))}
      </div>

      {jobs.filter(j=>j.status==="Urgent").length > 0 && (
        <div style={{background:"#FFF5F5",border:"1.5px solid #FEB2B2",borderRadius:14,padding:12,marginBottom:12}}>
          <div style={{fontSize:12,fontWeight:700,color:"#C53030",marginBottom:6}}>🚨 Urgents</div>
          {jobs.filter(j=>j.status==="Urgent").map(job => {
            const m = machines.find(m=>m.id===job.machineId);
            return <div key={job.key} style={{fontSize:12,color:"#742A2A",marginBottom:2}}><strong>{job.client}</strong> — {job.description||"–"} ({m?.label}, {hLabel(job.startHour)}→{hLabel(job.startHour+job.duration)})</div>;
          })}
        </div>
      )}

      <div style={{background:"white",borderRadius:14,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.07)"}}>
        <div style={{padding:"10px 14px",background:"#1A1A2E",color:"white",fontWeight:700,fontSize:12}}>Toutes les commandes ({jobs.length})</div>
        {jobs.length===0 ? <div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune commande ce jour</div> : (
          <table style={{width:"100%",borderCollapse:"collapse"}}>
            <thead><tr style={{background:"#FAFAF8"}}>
              {["Client","Description","Machine","Horaire","Durée","Statut"].map(h=>(
                <th key={h} style={{padding:"7px 10px",fontSize:11,color:"#718096",fontWeight:600,textAlign:"left",borderBottom:"1px solid #F0EDE8"}}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{jobs.sort((a,b)=>a.startHour-b.startHour).map((job,i)=>{
              const m=machines.find(m=>m.id===job.machineId), sc=STATUS_COLORS[job.status];
              return <tr key={job.key} style={{background:i%2===0?"white":"#FDFCFB"}}>
                <td style={{padding:"7px 10px",fontWeight:600,fontSize:12,borderBottom:"1px solid #F7F4F0"}}>{job.client}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#718096",borderBottom:"1px solid #F7F4F0"}}>{job.description||"—"}</td>
                <td style={{padding:"7px 10px",fontSize:11,borderBottom:"1px solid #F7F4F0"}}><span style={{background:m?.color+"20",color:m?.color,padding:"2px 6px",borderRadius:5,fontWeight:600,fontSize:10}}>{m?.label}</span></td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{hLabel(job.startHour)} → {hLabel(job.startHour+job.duration)}</td>
                <td style={{padding:"7px 10px",fontSize:11,color:"#4A5568",borderBottom:"1px solid #F7F4F0"}}>{job.duration}h</td>
                <td style={{padding:"7px 10px",borderBottom:"1px solid #F7F4F0"}}><span style={{background:sc.bg,color:sc.text,border:`1px solid ${sc.border}`,padding:"2px 6px",borderRadius:5,fontSize:10,fontWeight:600}}>{STATUS_LABELS[job.status]}</span></td>
              </tr>;
            })}</tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Panneaux secondaires ──────────────────────────────────────────────────────
function NotifPanel({ notifs, onMarkRead, onDelete, onClose }) {
  return (
    <div style={{position:"fixed",top:62,right:12,width:370,maxHeight:"70vh",background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,display:"flex",flexDirection:"column",overflow:"hidden"}}>
      <div style={{padding:"11px 14px",background:"#1A1A2E",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>🔔 Modifications du planning</span>
        <div style={{display:"flex",gap:7}}>
          <button onClick={onMarkRead} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,padding:"3px 9px",cursor:"pointer",fontSize:11}}>Tout lire</button>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
        </div>
      </div>
      <div style={{overflowY:"auto",flex:1}}>
        {notifs.length===0
          ? <div style={{padding:20,textAlign:"center",color:"#A0AEC0",fontSize:13}}>Aucune notification</div>
          : notifs.map(n => {
              const icon = n.action==="ajout"?"➕":n.action==="suppression"?"🗑":n.action==="deplacement"?"↔️":"✏️";
              return (
                <div key={n.key} style={{padding:"9px 13px",borderBottom:"1px solid #F7F4F0",background:n.read?"white":"#EBF4FF",display:"flex",gap:9,alignItems:"flex-start"}}>
                  <span style={{fontSize:14,flexShrink:0,marginTop:1}}>{icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,color:"#2D3748",lineHeight:1.4}}>{n.details}</div>
                    <div style={{fontSize:10,color:"#A0AEC0",marginTop:2}}>{ROLE_LABELS[n.role]||n.role} <strong>{n.user}</strong> · {fmtDateTime(n.ts)}</div>
                  </div>
                  {!n.read && <div style={{width:7,height:7,borderRadius:"50%",background:"#E07A5F",flexShrink:0,marginTop:4}}/>}
                  <button onClick={() => onDelete(n.key)} style={{background:"none",border:"none",cursor:"pointer",color:"#CBD5E0",fontSize:13,flexShrink:0}}>×</button>
                </div>
              );
            })
        }
      </div>
    </div>
  );
}

function AdminPanel({ allUsers, onClose }) {
  return (
    <div style={{position:"fixed",top:62,right:12,width:390,background:"white",borderRadius:14,boxShadow:"0 8px 40px rgba(0,0,0,0.18)",zIndex:900,overflow:"hidden"}}>
      <div style={{padding:"11px 14px",background:"#3D405B",color:"white",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <span style={{fontWeight:700,fontSize:12}}>⚙️ Gestion des utilisateurs</span>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:22,height:22,cursor:"pointer",fontSize:13}}>×</button>
      </div>
      <div style={{padding:14}}>
        <div style={{fontSize:11,color:"#718096",marginBottom:10,background:"#F7F4F0",borderRadius:8,padding:"8px 10px"}}>
          <strong>Admin</strong> : tout faire + notifications · <strong>Opérateur</strong> : ajouter et modifier · <strong>Lecteur</strong> : consulter uniquement
        </div>
        {Object.entries(allUsers).length===0
          ? <div style={{color:"#A0AEC0",fontSize:12,textAlign:"center",padding:10}}>Aucun utilisateur</div>
          : Object.entries(allUsers).map(([uid,u]) => (
              <div key={uid} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #F7F4F0"}}>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:600,color:"#2D3748",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name||u.email}</div>
                  <div style={{fontSize:10,color:"#A0AEC0"}}>{u.email}</div>
                </div>
                <select value={u.role||"lecteur"} onChange={e => update(ref(db,`users/${uid}`),{role:e.target.value})}
                  style={{padding:"5px 8px",borderRadius:7,border:"1.5px solid #E2E8F0",fontSize:12,cursor:"pointer",fontWeight:600,
                    background:u.role==="admin"?"#FEFCE8":u.role==="operateur"?"#F0FDF4":"#F9FAFB",
                    color:u.role==="admin"?"#854D0E":u.role==="operateur"?"#166534":"#4B5563"}}>
                  <option value="admin">Administrateur</option>
                  <option value="operateur">Opérateur</option>
                  <option value="lecteur">Lecteur</option>
                </select>
              </div>
            ))
        }
      </div>
    </div>
  );
}

// ─── Login ─────────────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, error }) {
  const [email, setEmail] = useState("");
  const [pass,  setPass]  = useState("");
  return (
    <div style={{minHeight:"100vh",background:"#F7F4F0",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{background:"white",borderRadius:20,padding:36,width:320,boxShadow:"0 8px 40px rgba(0,0,0,0.12)"}}>
        <div style={{textAlign:"center",marginBottom:22}}>
          <div style={{fontSize:38}}>🧵</div>
          <div style={{fontSize:20,fontWeight:800,color:"#1A1A2E",marginTop:6}}>PlanBrod</div>
          <div style={{fontSize:11,color:"#A0AEC0",marginTop:2}}>Connectez-vous pour accéder au planning</div>
        </div>
        {error && <div style={{background:"#FEE2E2",color:"#991B1B",borderRadius:8,padding:"8px 12px",fontSize:12,marginBottom:12,textAlign:"center"}}>{error}</div>}
        <div style={{marginBottom:11}}>
          <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Email</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="votre@email.com"
            style={{width:"100%",padding:"9px 11px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}} />
        </div>
        <div style={{marginBottom:18}}>
          <label style={{fontSize:11,fontWeight:600,color:"#555",display:"block",marginBottom:3}}>Mot de passe</label>
          <input type="password" value={pass} onChange={e=>setPass(e.target.value)} placeholder="••••••••"
            onKeyDown={e=>e.key==="Enter"&&onLogin(email,pass)}
            style={{width:"100%",padding:"9px 11px",borderRadius:9,border:"1.5px solid #E2E8F0",fontSize:13,boxSizing:"border-box"}} />
        </div>
        <button onClick={()=>onLogin(email,pass)} style={{width:"100%",padding:"10px",borderRadius:9,border:"none",background:"#1A1A2E",color:"white",fontWeight:700,cursor:"pointer",fontSize:13}}>
          Se connecter
        </button>
      </div>
    </div>
  );
}

function Loader() {
  return <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",fontSize:13,color:"#718096",background:"#F7F4F0"}}>⏳ Chargement…</div>;
}

// ─── Styles ────────────────────────────────────────────────────────────────────
const navBtn  = {background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:6,width:26,height:26,cursor:"pointer",fontSize:15,fontWeight:700};
const iconBtn = {background:"rgba(255,255,255,0.15)",color:"white",border:"none",borderRadius:7,width:30,height:30,cursor:"pointer",fontSize:15,position:"relative"};
const selStyle = {width:"100%",padding:"7px 9px",borderRadius:8,border:"1.5px solid #E2E8F0",fontSize:12};
