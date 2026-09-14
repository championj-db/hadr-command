-- Grants for the hadr-command app service principal (client id of app 'hadr-command').
-- Run these as a metastore/catalog admin after reviewing:
GRANT USE CATALOG ON CATALOG au_pubsec_catalog TO `1e334226-7845-4e4c-813b-2ed88c99128e`;
GRANT USE SCHEMA ON SCHEMA au_pubsec_catalog.hadr TO `1e334226-7845-4e4c-813b-2ed88c99128e`;
GRANT SELECT ON SCHEMA au_pubsec_catalog.hadr TO `1e334226-7845-4e4c-813b-2ed88c99128e`;
GRANT MODIFY ON TABLE au_pubsec_catalog.hadr.live_qldtraffic_events TO `1e334226-7845-4e4c-813b-2ed88c99128e`;
GRANT MODIFY ON TABLE au_pubsec_catalog.hadr.live_bom_warnings TO `1e334226-7845-4e4c-813b-2ed88c99128e`;
