# Development

Keep domain rules independent of MCP, CLI and persistence. Services own immutable resume versions, application snapshots and execution state. MCP and CLI are adapters. Store private data only in the resolved data home: RESUME_AGENT_HOME, CLI default .resume-agent, or native DSH default DSH_HOME/storages/resume-grill; never commit credentials, resumes, attachments or databases.

Run npm run check, npm test and npm run build after service changes. Tests use temporary directories and fake SMTP only. Do not send real mail, use paid models, or run browser automation without explicit user authorization. Never expose approval creation as an MCP tool; real sending needs human confirmation bound to the immutable preview digest through the interactive CLI, user-only native DSH card commands, or authenticated local React panel, plus a separate environment opt-in.

Tasks orchestrates saved search goals, public source reads and reviewed preparation batches. Career readers must enforce public HTTPS destinations and bounded requests, retain source failures, and never invent JDs or email addresses. Candidate rules are shared by MCP and React through the task service. Batch preparation cannot approve or send mail; prior user consent to a proposal must not carry over when its ID changes.

Native DSH is a thin adapter over operations and Workspace. Interactive cards belong under the completed answer, not inside the collapsed tool process. Use framework slots and theme tokens; do not embed the standalone panel. UI actions use the human command channel; approval must never become a model tool. Persist only domain references for card recovery and read current statuses; restoring a card must not create an application or an approval.
