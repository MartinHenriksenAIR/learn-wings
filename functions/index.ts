// Single entry point for the Azure Functions v4 programmatic model.
// The host loads this file (package.json "main": "dist/index.js"); importing
// each function module executes its app.http(...) registration.
import './admin-user-actions/index';
import './azure-delete-blob/index';
import './azure-document-upload-url/index';
import './azure-upload-url/index';
import './azure-view-url/index';
import './course-player-data/index';
import './delete-user/index';
import './enrollment-complete/index';
import './generate-certificate/index';
import './generate-compliance-report/index';
import './grade-quiz/index';
import './invitation-link/index';
import './lesson-progress/index';
import './org-analytics-data/index';
import './quiz-options/index';
import './quiz-options-admin/index';
import './send-invitation-email/index';
import './test-smtp-connection/index';
import './user-context/index';
