# Tests de non-régression du CRM Acqua Due

Ces fichiers ne sont **pas mis en ligne** (voir `.vercelignore`).

Préparation (une fois) : `npm install @electric-sql/pglite` dans ce dossier, et le code copié dans `/tmp/crm-acquadue`.

- Tests serveur (`tests-*.js`) : `node tests/<fichier>.js` (vraie base PostgreSQL de test en mémoire, aucune donnée réelle).
- Tests écran (`test-*.js`) : `node tests/<fichier>.js /tmp/crm-acquadue/index.html`.

Dernier passage complet : 19/11/2026 (2e partie) — 834/834 réussis (29 fichiers).
