import React, { useEffect, useState } from "react";
import { api } from "../../api.js";
import { Badge, DataTable, Empty, Modal } from "../../components/common.jsx";
import { fmtDateTime } from "./adminFormat.js";
import { MockResultRow } from "../History.jsx";

function testSessionStatusTone(s) { return s==="COMPLETED"?"good":s==="EXPIRED"?"bad":s==="ABANDONED"?"neutral":"info" }

export function AdminTestSessions() {
  const [sessions,setSessions]=useState([]);
  const [total,setTotal]=useState(0);
  const [totalPages,setTotalPages]=useState(1);
  const [page,setPage]=useState(1);
  const [status,setStatus]=useState("");
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [detailId,setDetailId]=useState(null);

  function load(pageArg) {
    setLoading(true); setError("");
    api.admin.testSessions.list({ page: pageArg||page, limit:20, status })
      .then(d=>{setSessions(d.testSessions);setTotal(d.total);setTotalPages(d.totalPages);setPage(d.page)})
      .catch(e=>setError(e.message))
      .finally(()=>setLoading(false));
  }
  useEffect(()=>{load(1)},[status]);

  return <div>
    <div className="panel-head">
      <div><h3>Mock test attempts</h3><p className="muted">{total} total</p></div>
    </div>
    {error && <div className="alert error">{error}</div>}
    <div className="filter-bar">
      <select value={status} onChange={e=>setStatus(e.target.value)} aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="IN_PROGRESS">In progress</option>
        <option value="COMPLETED">Completed</option>
        <option value="EXPIRED">Expired</option>
        <option value="ABANDONED">Abandoned</option>
      </select>
    </div>
    <DataTable
      loading={loading}
      rows={sessions}
      rowKey={s => s._id}
      emptyText="No mock test attempts match these filters."
      pagination={{ page, totalPages, total, itemLabel: "attempts", onPrevious: () => load(page - 1), onNext: () => load(page + 1) }}
      columns={[
        { key: "student", header: "Student", render: s => <b>{s.user?.username||"—"}</b> },
        { key: "status", header: "Status", render: s => <Badge tone={testSessionStatusTone(s.status)}>{s.status}</Badge> },
        { key: "score", header: "Score", render: s => `${s.totalScore}/${s.totalMaxScore}` },
        { key: "pendingAi", header: "Pending AI", render: s => s.pendingSubjective ? <Badge tone="warn">Pending</Badge> : "—" },
        { key: "started", header: "Started", render: s => fmtDateTime(s.startedAt) },
        { key: "submitted", header: "Submitted", render: s => fmtDateTime(s.submittedAt) },
        { key: "expires", header: "Expires", render: s => fmtDateTime(s.expiresAt) },
        { key: "actions", header: "Actions", render: s => <button className="text-button" onClick={()=>setDetailId(s._id)}>View</button> }
      ]}
    />
    {detailId && <AdminTestSessionDetail id={detailId} onClose={()=>setDetailId(null)}/>}
  </div>
}

function AdminTestSessionDetail({id, onClose}) {
  const [data,setData]=useState(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  useEffect(()=>{
    setLoading(true); setError("");
    api.admin.testSessions.get(id).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  },[id]);
  const s = data?.testSession;
  const title = s ? `${s.user?.username}'s mock attempt` : "Mock attempt";

  return <Modal onClose={onClose} title={title} ariaLabel={title} panelClassName="detail-panel">
    {loading ? <Empty text="Loading attempt..."/> : !s ? <div className="alert error">{error}</div> : <>
      <div className="mock-detail-summary">
        <Badge tone={testSessionStatusTone(s.status)}>{s.status}</Badge>
        <span className="score-pill">{s.totalScore}/{s.totalMaxScore}</span>
        <span className="muted">Started {fmtDateTime(s.startedAt)}</span>
      </div>
      <div className="mock-detail-list">
        {data.results.length ? data.results.map(r=><MockResultRow key={r._id} r={r}/>) : <p className="muted">No answers have been submitted in this attempt yet.</p>}
      </div>
    </>}
  </Modal>;
}
