<p align="center"><img src="../public/brand/logo-sl-approved-light.png" alt="СВОИ ЛЮДИ" width="180"></p>

# Vercel support request — draft, not sent

Prepared 19 November 2026. Sending requires a separate instruction from the owner.

**Subject:** One project consistently fails resource provisioning before build while a sibling project builds the same Git SHA.

Team: `team_jS9zoVLPrqpDItxMtZ7B8Fxb` (Hobby).

| | Failing | Successful sibling |
| --- | --- | --- |
| Project | my-gpt-chat / prj_VaHv4poqy8BAJNUrE7mNutBzDR1f | my-gpt-chat-2qe5 / prj_5M9H0K6MwkwKwjI53yTJsYlfMt1m |
| Deployment | dpl_HxKdEYMMMXwuoqw3sp9Q7SiWUBaq | dpl_FJXL5NDzHgTv1C1VYqMX6JFxYVqw |
| Git SHA | a4c24244495054b9cb4b4247703d8a2acf68fb18 | same |
| Created UTC | 2026-11-19 02:39:21.547 | 2026-11-19 02:39:21.455 |
| Terminal UTC | 2026-11-19 02:39:22.258 | 2026-11-19 02:40:30.739 |
| Result | BUILD_FAILED: Resource provisioning failed | READY |
| Total duration | 711 ms | 69284 ms |

A second existing pair reproduces this on SHA `863677688de016585f934d7565a1a50faec87eab`, branch `docs/ruflo-mcp-20261119`, around 12:36 UTC: `dpl_BG8ZLP359qY84Ldr21eQmmQffmon` ERROR in 420 ms versus `dpl_DAvF3y4NWZNomSFjb9LrQdxUYKEf` READY in 78671 ms.

Failing build-event endpoints return no build events. Successful sibling logs show a 2-core/8-GB builder and a completed Next.js build. Both projects are Git-linked to the same repository, use Next.js, and report Node 24.x project settings and iad1 deployment regions. Successful logs select Node 26.x due to package.json engines >=22; we have not established this as causal.

The main public alias remains assigned to the successful 4 November deployment `dpl_H4BNsqR5CbWeg9CPfGqZqZFwvDam`, SHA `9c8dcb52c89c68aaf2282cc33b2b04f59d0bea33`. Public status reports operational. No code, environment values, plan, deployments or aliases were changed during the audit.

**Request:** please inspect the internal provisioning trace and effective project-level build-resource configuration/entitlements for the failing deployments. Identify the exact failed allocation or validation, whether a quota/region/hidden setting is involved, and a reversible correction. Also verify both project GitHub bindings against current repository ID 1413195593; our withGitRepoInfo responses do not expose the numeric binding/installation IDs. We have no evidence that a stale binding is causal. Our available read-only API output does not expose complete builder settings or quota counters. Please do not change the plan or incur charges without owner approval.

Evidence and boundaries: [integration audit](INTEGRATION_AUDIT_20261119.md). No credentials or customer records are attached.
