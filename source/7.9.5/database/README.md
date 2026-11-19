# JEAuditFlow 7.9.5 Native MySQL Database Scaffold

This is a version-isolated 7.9 candidate scaffold. It targets only
`jeauditflow_795` on loopback port `43327` and contains no user data or
credentials. It is not an installed database and it does not migrate 7.7 data.

The 7.9 profile carries forward schema version 29 from 7.7 with no declared DDL
change. A future 7.9 candidate may add schema migrations after they are reviewed
and tested. Until then, keep the 7.7 native database and its files isolated.

The native scripts require a protected `MYSQL_DEFAULTS_FILE` and an exact
`APPLY jeauditflow_795` confirmation. Building or packaging this scaffold does
not start MySQL or write any database.
