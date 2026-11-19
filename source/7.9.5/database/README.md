# JEAuditFlow 7.9.5 Native MySQL Database Package

Fresh-install schema for the version-isolated `jeauditflow_795` database on
loopback port `43327`. It contains no user data or credentials. It does not
migrate 7.7 data.

Schema version 29 is carried forward from 7.7/7.8 with no DDL change. Tested
on MySQL 8.0.46 (InnoDB, utf8mb4).

1. As a MySQL administrator, create the database and application account:

   ```sh
   MYSQL_ADMIN_DEFAULTS_FILE=/root/.my.cnf MYSQL_PASSWORD='<app password>' \
     bash create-database.sh --confirm "CREATE jeauditflow_795"
   ```

2. Apply the schema with the application account's protected client config
   (`[client]` with `user=` and `password=`, mode 600):

   ```sh
   MYSQL_DEFAULTS_FILE=/etc/jeauditflow/mysql-client.cnf \
     bash install-schema.sh --confirm "APPLY jeauditflow_795"
   MYSQL_DEFAULTS_FILE=/etc/jeauditflow/mysql-client.cnf bash healthcheck.sh
   ```

`migrate.sh` re-applies the idempotent schema; the API adds its runtime columns
and indexes at startup. Writes always require the exact `--confirm` phrase.
