-- JEAuditFlow 4.3 shared-service data contract (MySQL 8 / InnoDB)
-- Glossary terms, translations and findings are project-scoped and revisioned.
create table if not exists auditflow_shared_glossary (
  id bigint unsigned not null auto_increment,
  project_id varchar(160) not null,
  term_key varchar(160) not null,
  source_locale varchar(16) not null default 'en',
  source_text varchar(500) not null,
  definition text not null,
  status enum('draft','approved','deprecated') not null default 'draft',
  version int unsigned not null default 1,
  updated_by varchar(160) not null,
  updated_at datetime(3) not null,
  primary key (id),
  unique key auditflow_glossary_project_term (project_id, term_key),
  key auditflow_glossary_project_status (project_id, status)
) engine=InnoDB;

create table if not exists auditflow_shared_translations (
  id bigint unsigned not null auto_increment,
  project_id varchar(160) not null,
  term_key varchar(160) not null,
  locale varchar(16) not null,
  translated_text varchar(500) not null,
  source_version int unsigned not null,
  status enum('machine-draft','human-reviewed','approved') not null default 'machine-draft',
  updated_by varchar(160) not null,
  updated_at datetime(3) not null,
  primary key (id),
  unique key auditflow_translation_project_key_locale (project_id, term_key, locale),
  key auditflow_translation_review (project_id, locale, status)
) engine=InnoDB;

create table if not exists auditflow_shared_findings (
  id bigint unsigned not null auto_increment,
  project_id varchar(160) not null,
  finding_key varchar(160) not null,
  process_area varchar(32) not null,
  title varchar(500) not null,
  description text not null,
  severity enum('observation','minor','major','critical') not null default 'observation',
  status enum('open','accepted','mitigated','verified','closed') not null default 'open',
  evidence_role enum('direct','corroborating','index-only') not null default 'direct',
  source_item_id varchar(160) null,
  owner_user_id varchar(160) null,
  due_at datetime(3) null,
  version int unsigned not null default 1,
  updated_by varchar(160) not null,
  updated_at datetime(3) not null,
  primary key (id),
  unique key auditflow_finding_project_key (project_id, finding_key),
  key auditflow_finding_project_status (project_id, status, severity),
  key auditflow_finding_source_item (project_id, source_item_id)
) engine=InnoDB;

create table if not exists auditflow_shared_finding_links (
  finding_id bigint unsigned not null,
  linked_item_id varchar(160) not null,
  link_role enum('implements','verified-by','caused-by','evidence-for','relates-to') not null,
  created_by varchar(160) not null,
  created_at datetime(3) not null,
  primary key (finding_id, linked_item_id, link_role),
  constraint auditflow_finding_link_fk foreign key (finding_id) references auditflow_shared_findings(id) on delete cascade
) engine=InnoDB;
