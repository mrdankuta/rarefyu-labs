// Older tests create workspaces with one identity and read them back anonymously.
// Ownership enforcement is ON by default (see app.ts); suites that exercise it opt in.
process.env.ENFORCE_OWNERSHIP = "0";
