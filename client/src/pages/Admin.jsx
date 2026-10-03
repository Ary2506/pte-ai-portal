import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AdminQuestionsPanel } from "./admin/AdminQuestions.jsx";
import { Page } from "../components/common.jsx";
import { AdminDashboard } from "./admin/AdminDashboard.jsx";
import { AdminUsers } from "./admin/AdminUsers.jsx";
import { AdminTestSessions } from "./admin/AdminTestSessions.jsx";
import { useToast } from "../components/toast.jsx";

export default function Admin() {
	const [searchParams, setSearchParams] = useSearchParams();
	const [tab,setTabState]=useState(() => searchParams.get("tab") || "dashboard");
	const [usersFilter,setUsersFilter]=useState(null);

	useEffect(() => {
		const urlTab = searchParams.get("tab") || "dashboard";
		setTabState(current => current === urlTab ? current : urlTab);
	}, [searchParams]);

	function setTab(next) {
		setTabState(next);
		setSearchParams(next === "dashboard" ? {} : { tab: next });
	}

	// Same host, same timings as the rest of the product — see components/toast.jsx.
	const toast = useToast();
	function notify(type, message) { toast.toast(message, type); }
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
	</Page>;
}
