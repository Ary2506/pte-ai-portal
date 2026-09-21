import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Badge, ConfirmDialog, DataTable, Empty, Modal } from "../../components/common.jsx";
import { fmtDate, fmtDateTime } from "./adminFormat.js";
// Temporary/emergency admin feature — see the removal note at the top of
// AdminSubscriptionExtension.jsx for exactly what to delete, including these two lines and their
// two call sites below (each marked with a matching comment).
import { ExtendAllActiveButton, ExtendSubscriptionButton } from "./AdminSubscriptionExtension.jsx";

function accountStatusTone(s){ return s==="ACTIVE"?"good":s==="BLOCKED"?"bad":"warn" }
function paymentStatusTone(s){ return s==="PAID"?"good":s==="PENDING"?"warn":s==="FAILED"?"bad":"neutral" }
function subscriptionTone(s){ return s==="ACTIVE"?"good":s==="EXPIRED"?"bad":"neutral" }
// Maps the exact `reason` code the server already returns on a rejected sign-in to a short,
// student-safe label an admin can scan quickly — never a raw device identifier here.
function loginAttemptReasonLabel(reason) {
  const labels = {
    SUCCESS: "Signed in",
    INVALID_CREDENTIALS: "Wrong User ID or password",
    ACCOUNT_BLOCKED: "Account blocked",
    ACCOUNT_SUSPENDED: "Account suspended",
    SUBSCRIPTION_EXPIRED: "Subscription expired",
    SUBSCRIPTION_INACTIVE: "Subscription not activated",
    DEVICE_NOT_REGISTERED: "Device restriction",
    ACCOUNT_ALREADY_ACTIVE: "Already active on another device"
  };
  return labels[reason] || reason;
}
function daysRemaining(u){
  if(!u.subscriptionEndDate || u.subscriptionStatus!=="ACTIVE") return "—";
  return Math.max(0, Math.ceil((new Date(u.subscriptionEndDate)-Date.now())/86400000));
}

const SUBSCRIPTION_FILTERS = [
  ["", "All subscriptions"], ["ACTIVE","Active"], ["EXPIRING","Expiring soon (7 days)"], ["EXPIRED","Expired"], ["NOT_ACTIVATED","Not activated"]
];

// The message an admin copies and sends to a newly created student — reuses window.location.origin
// (the real address this admin panel is actually running at) rather than hardcoding a domain, so
// it's correct in every environment without configuration.
function buildAccountCreatedMessage({ username, password }) {
  const loginUrl = window.location.origin;
  return `MyPTEScore – Your Path to PTE Success

Comprehensive PTE exam preparation with AI-powered scoring at myptescore.com

Hello! 👋

Your MyPTEScore account is ready.

🔐 Login Details

👤 Username: ${username}
🔑 Password: ${password}

🌐 Login here: ${loginUrl}

⚠️ IMPORTANT NOTE

Your account is device restricted. It will only work on one device and one browser.

👉 Please log in from the device and browser you plan to use every day.

Once logged in, your account will automatically be locked to that device and browser. You will not be able to access your account from another device or browser.

🔒 This restriction helps protect your account and prevents account sharing.

If you need to change your device or browser, please contact the administrator for assistance.

Please log in and start practicing. Feel free to reach out if you need any help! 😊`;
}

function buildPasswordResetMessage({ username, password }) {
  const loginUrl = window.location.origin;
  return `MyPTEScore – Your Path to PTE Success

Hello! 👋

Your MyPTEScore password has been reset.

🔐 Updated Login Details

👤 Username: ${username}
🔑 Your new password: ${password}

🌐 Login here: ${loginUrl}

⚠️ IMPORTANT NOTE

For your security, you have been signed out from any active session. Please sign in again using your new password.

Your account is device restricted. Please log in from the device and browser you plan to use every day.

If you need any help, please contact the administrator.`;
}

function CredentialMessageModal({ title, description, message, onClose }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(message).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {});
  }
  return <Modal onClose={onClose} title={title} ariaLabel={title}
    footer={<>
      <button className="secondary" onClick={onClose}>Close</button>
      <button className="primary" onClick={copy}>{copied ? "Copied!" : "Copy message"}</button>
    </>}>
    <p className="muted" style={{marginTop:-6}}>{description}</p>
    <textarea readOnly className="answer-area" style={{height:360,fontFamily:"monospace",fontSize:12}} value={message} onClick={e => e.target.select()}/>
  </Modal>;
}

function AccountCreatedModal({ account, onClose }) {
  return <CredentialMessageModal
    title="Account created"
    description="Copy this message and send it to the student — it includes their login details and explains the one-device/one-browser policy."
    message={buildAccountCreatedMessage(account)}
    onClose={onClose}
  />;
}

function PasswordResetModal({ account, onClose }) {
  return <CredentialMessageModal
    title="Password reset"
    description="Copy this message and send it to the student — it clearly includes their new password and explains that they must sign in again."
    message={buildPasswordResetMessage(account)}
    onClose={onClose}
  />;
}

export function AdminUsers({notify, initialFilters, onFiltersApplied}) {
  const [users,setUsers]=useState([]);
  const [total,setTotal]=useState(0);
  const [totalPages,setTotalPages]=useState(1);
  const [page,setPage]=useState(1);
  const [search,setSearch]=useState("");
  const [status,setStatus]=useState("");
  const [paymentStatus,setPaymentStatus]=useState("");
  const [subscription,setSubscription]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [showCreate,setShowCreate]=useState(false);
  const [creating,setCreating]=useState(false);
  const [form,setForm]=useState({username:"",name:"",email:"",password:"",paymentStatus:"PAID",subscriptionDays:30});
  const [detailId,setDetailId]=useState(null);
  const [createdAccount,setCreatedAccount]=useState(null);

  useEffect(()=>{
    if (!initialFilters) return;
    setStatus(initialFilters.status||"");
    setPaymentStatus(initialFilters.paymentStatus||"");
    setSubscription(initialFilters.subscription||"");
    onFiltersApplied?.();
  },[initialFilters]);

  function load(pageArg) {
    setLoading(true); setError("");
    api.admin.listUsers({ page: pageArg||page, limit:20, search, status, paymentStatus, subscription })
      .then(d=>{setUsers(d.users);setTotal(d.total);setTotalPages(d.totalPages);setPage(d.page)})
      .catch(e=>setError(e.message))
      .finally(()=>setLoading(false));
  }
  useEffect(()=>{load(1)},[status,paymentStatus,subscription]);

  async function createUser(e) {
    e.preventDefault(); setCreating(true); setError("");
    try {
      const d = await api.admin.createUser(form);
      notify("success", `User "${d.user.username}" created. Temporary password: ${d.temporaryPassword} — share this with them securely.`);
      setCreatedAccount({ username: d.user.username, password: d.temporaryPassword });
      setForm({username:"",name:"",email:"",password:"",paymentStatus:"PAID",subscriptionDays:30});
      setShowCreate(false);
      load(1);
    } catch (e) { setError(e.message); } finally { setCreating(false); }
  }

  return <div>
    <div className="panel-head">
      <div><h3>User accounts</h3><p className="muted">{total} total · registration is admin-only</p></div>
      <div style={{display:"flex",gap:10}}>
        {/* Temporary/emergency admin feature — see AdminSubscriptionExtension.jsx's removal note */}
        <ExtendAllActiveButton onExtended={()=>load()}/>
        <button className="primary" onClick={()=>setShowCreate(s=>!s)}>{showCreate ? "Cancel" : "+ Create user"}</button>
      </div>
    </div>
    {error && <div className="alert error">{error}</div>}
    {showCreate && <form onSubmit={createUser} className="admin-create-form">
      <label>User ID<input required value={form.username} onChange={e=>setForm({...form,username:e.target.value})} placeholder="pte002"/></label>
      <label>Name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Full name"/></label>
      <label>Email (optional)<input type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></label>
      <label>Password (blank = auto-generate)<input value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></label>
      <label>Payment status
        <select value={form.paymentStatus} onChange={e=>setForm({...form,paymentStatus:e.target.value})}>
          <option value="PAID">Paid — activate now</option>
          <option value="PENDING">Pending — don't activate yet</option>
        </select>
      </label>
      <label>Subscription length
        <select value={form.subscriptionDays} onChange={e=>setForm({...form,subscriptionDays:e.target.value})}>
          <option value={30}>30 days</option><option value={60}>60 days</option><option value={90}>90 days</option>
        </select>
      </label>
      <button className="primary" disabled={creating}>{creating ? "Creating..." : "Create user"}</button>
    </form>}
    <div className="filter-bar">
      <div className="search admin-search"><span aria-hidden="true">⌕</span><input placeholder="Search by User ID, name or email..." aria-label="Search users" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(1)}/></div>
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter by account status">
        <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="BLOCKED">Blocked</option><option value="SUSPENDED">Suspended</option>
      </select>
      <select value={paymentStatus} onChange={e=>setPaymentStatus(e.target.value)} aria-label="Filter by payment status">
        <option value="">All payments</option><option value="PAID">Paid</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option>
      </select>
      <select value={subscription} onChange={e=>setSubscription(e.target.value)} aria-label="Filter by subscription status">
        {SUBSCRIPTION_FILTERS.map(([v,l])=><option key={v} value={v}>{l}</option>)}
      </select>
    </div>
    <DataTable
      loading={loading}
      rows={users}
      rowKey={u => u.id}
      emptyText="No users match these filters."
      pagination={{ page, totalPages, total, itemLabel: "users", onPrevious: () => load(page - 1), onNext: () => load(page + 1) }}
      columns={[
        { key: "username", header: "User ID", render: u => <><b>{u.username}</b>{u.role==="admin" && <span className="chip" style={{marginLeft:6}}>admin</span>}</> },
        { key: "name", header: "Name", render: u => u.name },
        { key: "email", header: "Email", cellClassName: "mono-cell", render: u => u.email||"—" },
        { key: "status", header: "Status", render: u => <Badge tone={accountStatusTone(u.accountStatus)}>{u.accountStatus}</Badge> },
        { key: "payment", header: "Payment", render: u => <Badge tone={paymentStatusTone(u.paymentStatus)}>{u.paymentStatus}</Badge> },
        { key: "subscription", header: "Subscription", render: u => <Badge tone={subscriptionTone(u.subscriptionStatus)}>{u.subscriptionStatus.replace("_"," ")}</Badge> },
        { key: "daysLeft", header: "Days left", render: u => daysRemaining(u) },
        { key: "lastLogin", header: "Last login", render: u => fmtDateTime(u.lastLoginAt) },
        { key: "session", header: "Session", render: u => <Badge tone={u.sessionStatus==="ACTIVE"?"info":"neutral"}>{u.sessionStatus}</Badge> },
        { key: "created", header: "Created", render: u => fmtDate(u.createdAt) },
        { key: "actions", header: "Actions", render: u => u.role!=="admin" && <button className="text-button" onClick={()=>setDetailId(u.id)}>Manage</button> }
      ]}
    />
    {detailId && <AdminUserDetail id={detailId} notify={notify} onClose={()=>{setDetailId(null); load();}}/>}
    {createdAccount && <AccountCreatedModal account={createdAccount} onClose={()=>setCreatedAccount(null)}/>}
  </div>
}

function AdminUserDetail({id, notify, onClose}) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [confirmAction,setConfirmAction]=useState(null);
  const [customDays,setCustomDays]=useState("");
  const [subForm,setSubForm]=useState({paymentStatus:"PENDING",subscriptionStartDate:"",subscriptionEndDate:""});
  const [busy,setBusy]=useState(false);
  const [resetAccount,setResetAccount]=useState(null);

  function load(){
    setLoading(true); setError("");
    api.admin.getUser(id).then(d=>{
      setData(d);
      setSubForm({
        paymentStatus: d.user.paymentStatus,
        subscriptionStartDate: d.user.subscriptionStartDate ? d.user.subscriptionStartDate.slice(0,10) : "",
        subscriptionEndDate: d.user.subscriptionEndDate ? d.user.subscriptionEndDate.slice(0,10) : ""
      });
    }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }
  useEffect(()=>{load()},[id]);

  async function act(fn, successMsg) {
    setBusy(true); setError("");
    try { await fn(); notify("success", successMsg); load(); }
    catch (e) { setError(e.message); notify("error", e.message); }
    finally { setBusy(false); }
  }

  async function runConfirm() {
    if (!confirmAction) return;
    setBusy(true);
    try { await confirmAction.run(); notify("success", confirmAction.successMsg); setConfirmAction(null); load(); }
    catch (e) { notify("error", e.message); setConfirmAction(null); }
    finally { setBusy(false); }
  }

  const u = data?.user;

  return <>
    <Modal onClose={onClose} title={u ? u.name : "User details"} ariaLabel={u ? u.name : "User details"} panelClassName="detail-panel">
      {loading ? <Empty text="Loading user..."/> : !u ? <div className="alert error">{error}</div> : <>
        {error && <div className="alert error">{error}</div>}
        <div className="detail-grid">
          <section>
            <h4>Account</h4>
            <dl>
              <dt>User ID</dt><dd>{u.username}</dd>
              <dt>Name</dt><dd>{u.name}</dd>
              <dt>Email</dt><dd>{u.email||"—"}</dd>
              <dt>Status</dt><dd><Badge tone={accountStatusTone(u.accountStatus)}>{u.accountStatus}</Badge></dd>
              <dt>Created</dt><dd>{fmtDateTime(u.createdAt)}</dd>
              <dt>Created by</dt><dd>{u.createdBy?.username||"—"}</dd>
            </dl>
          </section>
          <section>
            <h4>Subscription</h4>
            <dl>
              <dt>Payment</dt><dd><Badge tone={paymentStatusTone(u.paymentStatus)}>{u.paymentStatus}</Badge></dd>
              <dt>Payment ID</dt><dd>{u.paymentId||"—"}</dd>
              <dt>Start</dt><dd>{fmtDate(u.subscriptionStartDate)}</dd>
              <dt>Expiry</dt><dd>{fmtDate(u.subscriptionEndDate)}</dd>
              <dt>Days remaining</dt><dd>{daysRemaining(u)}</dd>
              <dt>Status</dt><dd><Badge tone={subscriptionTone(u.subscriptionStatus)}>{u.subscriptionStatus.replace("_"," ")}</Badge></dd>
            </dl>
            {/* Temporary/emergency admin feature — see AdminSubscriptionExtension.jsx's removal note */}
            <ExtendSubscriptionButton user={u} onExtended={load}/>
          </section>
          <section>
            <h4>Login &amp; sessions</h4>
            <dl><dt>Last login</dt><dd>{fmtDateTime(u.lastLoginAt)}</dd></dl>
            <div className="session-list">
              {data.sessions.length ? data.sessions.map(s=><div className="session-row" key={s.id}>
                <Badge tone={s.status==="ACTIVE"?"info":s.status==="REVOKED"?"bad":"neutral"}>{s.status}</Badge>
                <div>
                  <small>{s.userAgent||"Unknown device"}{s.ipAddress?` · ${s.ipAddress}`:""}</small>
                  <small className="muted">Created {fmtDateTime(s.createdAt)} · Last active {fmtDateTime(s.lastActiveAt)}</small>
                </div>
              </div>) : <p className="muted">No sessions yet.</p>}
            </div>
          </section>
        </div>

        <h4>Recent login attempts</h4>
        <div className="session-list">
          {data.loginAttempts?.length ? data.loginAttempts.map(a=><div className="session-row" key={a.id}>
            <Badge tone={a.success?"good":"bad"}>{a.success?"Success":"Failed"}</Badge>
            <div>
              <small>{loginAttemptReasonLabel(a.reason)}{a.ipAddress?` · ${a.ipAddress}`:""}</small>
              <small className="muted">{fmtDateTime(a.createdAt)}</small>
            </div>
          </div>) : <p className="muted">No login attempts recorded yet.</p>}
        </div>

        <h4>Actions</h4>
        <div className="detail-actions">
          {u.accountStatus!=="ACTIVE" && <button className="secondary" disabled={busy} onClick={()=>act(()=>api.admin.setStatus(u.id,"ACTIVE"),"Account activated")}>Activate</button>}
          {u.accountStatus!=="BLOCKED" && <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Block this user?",message:`${u.username} will immediately lose access and be signed out of any active session.`,label:"Block user",danger:true,successMsg:"User blocked",run:()=>api.admin.setStatus(u.id,"BLOCKED")})}>Block</button>}
          {u.accountStatus!=="SUSPENDED" && <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Suspend this user?",message:`${u.username} will immediately lose access and be signed out of any active session.`,label:"Suspend user",danger:true,successMsg:"User suspended",run:()=>api.admin.setStatus(u.id,"SUSPENDED")})}>Suspend</button>}
          <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Force logout?",message:`Any active session for ${u.username} will be revoked immediately.`,label:"Force logout now",danger:true,successMsg:"Sessions revoked",run:()=>api.admin.revokeSessions(u.id)})}>Force logout</button>
          <button className="secondary" disabled={busy} onClick={()=>setConfirmAction({title:"Reset password?",message:`A new temporary password will be generated for ${u.username} and all their sessions will be signed out.`,label:"Reset password now",danger:false,successMsg:"Password reset",run:async()=>{const d=await api.admin.resetPassword(u.id,"");setResetAccount({username:u.username,password:d.temporaryPassword})}})}>Reset password</button>
        </div>

        <h4>Renew subscription</h4>
        <div className="renew-row">
          {[30,60,90].map(d=><button key={d} className="secondary" disabled={busy} onClick={()=>act(()=>api.admin.renew(u.id,d), `Renewed for ${d} days`)}>+{d} days</button>)}
          <input type="number" min="1" placeholder="Custom days" aria-label="Custom number of days" value={customDays} onChange={e=>setCustomDays(e.target.value)}/>
          <button className="secondary" disabled={busy||!customDays} onClick={()=>act(()=>api.admin.renew(u.id,Number(customDays)), `Renewed for ${customDays} days`)}>Apply</button>
        </div>

        <h4>Change subscription</h4>
        <form className="admin-create-form" onSubmit={e=>{e.preventDefault();act(()=>api.admin.setSubscription(u.id,{paymentStatus:subForm.paymentStatus,subscriptionStartDate:subForm.subscriptionStartDate||undefined,subscriptionEndDate:subForm.subscriptionEndDate||undefined}),"Subscription updated")}}>
          <label>Payment status<select value={subForm.paymentStatus} onChange={e=>setSubForm({...subForm,paymentStatus:e.target.value})}>
            <option value="PENDING">Pending</option><option value="PAID">Paid</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option>
          </select></label>
          <label>Start date<input type="date" value={subForm.subscriptionStartDate} onChange={e=>setSubForm({...subForm,subscriptionStartDate:e.target.value})}/></label>
          <label>Expiry date<input type="date" value={subForm.subscriptionEndDate} onChange={e=>setSubForm({...subForm,subscriptionEndDate:e.target.value})}/></label>
          <button className="primary" disabled={busy}>Save subscription</button>
        </form>
      </>}
    </Modal>
    <ConfirmDialog open={!!confirmAction} title={confirmAction?.title} message={confirmAction?.message} confirmLabel={confirmAction?.label} danger={confirmAction?.danger} busy={busy} onConfirm={runConfirm} onCancel={()=>setConfirmAction(null)}/>
    {resetAccount && <PasswordResetModal account={resetAccount} onClose={()=>setResetAccount(null)}/>}
  </>
}
