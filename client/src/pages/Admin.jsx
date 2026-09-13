import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminQuestionsPanel } from "../AdminQuestions.jsx";
import { Page } from "../components/common.jsx";
import { AdminDashboard, AdminUsers, AdminTestSessions, ToastHost } from "../App.jsx";

export default function Admin() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [tab,setTabState]=useState(() => searchParams.get("tab") || "dashboard");
	const [toasts,setToasts]=useState([]);
	const [usersFilter,setUsersFilter]=useState(null);

	useEffect(() => {
		const urlTab = searchParams.get("tab") || "dashboard";
		setTabState(current => current === urlTab ? current : urlTab);
	}, [searchParams]);

	function setTab(next) {
		setTabState(next);
		setSearchParams(next === "dashboard" ? {} : { tab: next });
	}

	function notify(type, message) {
		const id = Date.now()+Math.random();
		setToasts(t=>[...t,{id,type,message}]);
		setTimeout(()=>setToasts(t=>t.filter(x=>x.id!==id)), 6000);
	}
	function goToUsers(filters) { setUsersFilter(filters); setTab("users"); }

	return <Page title="Admin Panel" subtitle="Manage users and the practice content library.">
		<div className="practice-tabs">
			<button className={tab==="dashboard"?"tab active":"tab"} onClick={()=>setTab("dashboard")}>Dashboard</button>
			<button className={tab==="users"?"tab active":"tab"} onClick={()=>setTab("users")}>Users</button>
			<button className={tab==="questions"?"tab active":"tab"} onClick={()=>setTab("questions")}>Questions</button>
			<button className={tab==="testSessions"?"tab active":"tab"} onClick={()=>setTab("testSessions")}>Test Sessions</button>
		</div>
		{tab==="dashboard" && <AdminDashboard notify={notify} goToUsers={goToUsers} goToQuestions={()=>setTab("questions")}/>} 
		{tab==="users" && <div className="panel"><AdminUsers notify={notify} initialFilters={usersFilter} onFiltersApplied={()=>setUsersFilter(null)}/></div>}
		{tab==="questions" && <div className="panel"><AdminQuestionsPanel notify={notify}/></div>}
		{tab==="testSessions" && <div className="panel"><AdminTestSessions/></div>}
		<ToastHost toasts={toasts} dismiss={id=>setToasts(t=>t.filter(x=>x.id!==id))}/>
	</Page>;
}
