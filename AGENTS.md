# Development

Keep domain rules independent of MCP, CLI and persistence. Services own immutable resume versions, application snapshots and execution state. MCP and CLI are adapters. Store private data only under RESUME_AGENT_HOME (default .resume-agent); never commit credentials, resumes, attachments or databases.

Run npm run check, npm test and npm run build after service changes. Tests use temporary directories and fake SMTP only. Do not send real mail, use paid models, or run browser automation without explicit user authorization. Never expose approval creation as an MCP tool; real sending needs a human CLI approval bound to the immutable preview digest and a separate environment opt-in.
