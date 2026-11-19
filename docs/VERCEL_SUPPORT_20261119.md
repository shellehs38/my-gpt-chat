<p align="center"><img src="../public/brand/logo-sl-approved-light.png" alt="СВОИ ЛЮДИ" width="180"></p>

# Vercel support request — draft, not sent

Prepared 19 November 2026. Use this draft if the provisioning error persists after the Supabase project resumes. Sending requires a separate instruction from the owner.

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

Vercel Storage reports that the Supabase resource `supabase-coral-planet` (`store_CWHeLik7O6o0RbTP`, external project ref `ipjakegqcqjkejrwdcts`) is suspended. It is connected only to `my-gpt-chat` in Preview and Production with `deployments.required=true`. Its notification directs the owner to resume the project in Supabase Dashboard. The Vercel project filter by GitHub repository ID `1413195593` returned both projects.

The latest comparison is Preview on SHA `6f1ef0655b7adc5738cb597afbe3981d19d51af4`: `dpl_58JxTQLSeWrCkExBuujo3deyoTtp` failed at provisioning after 502 ms with no build events, while `dpl_2kKk3wzB1xG4tUVFk5qeAotjX6BH` reached READY.

**Request:** if a new Preview still fails after Supabase resumes, please verify the synchronized resource state and inspect the provisioning trace. Identify the blocking validation and a reversible correction. Please preserve the existing resource and project connections and do not change the plan or incur charges without owner approval.

Evidence and boundaries: [integration audit](INTEGRATION_AUDIT_20261119.md). No credentials or customer records are attached.
