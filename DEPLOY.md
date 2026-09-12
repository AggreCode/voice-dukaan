# Deploy for free (Render + Neon)

Two free accounts, no credit card, about 20 minutes. The web app and the API run as one container,
so there is a single URL and no CORS setup.

## 1. Database on Neon (free, permanent)

1. Sign up at <https://neon.com>.
2. Create a project in region **AWS ap-southeast-1 (Singapore)**, the closest free region to India.
3. Copy the connection string. It looks like
   `postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
4. Rewrite it for this app: scheme `postgresql+asyncpg://` and `ssl=require` instead of `sslmode=require`:
   `postgresql+asyncpg://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?ssl=require`

Free plan: 0.5 GB storage, scales to zero when idle, no card, no expiry date.

## 2. Push the code to GitHub

```bash
cd ~/Desktop/side_projects/voice-dukan
git add -A && git commit -m "Voice Dukan"
# create an empty repo at https://github.com/new (private is fine), then:
git remote add origin https://github.com/<you>/voice-dukan.git
git push -u origin main
```
`.env` and `secrets/` are git-ignored, so no keys reach GitHub.

## 3. Web service on Render (free)

1. Sign up at <https://render.com> with GitHub and grant access to the repo.
2. **New → Blueprint**, choose the repo. Render reads `render.yaml` and creates a free web service.
3. Fill in the three secrets it asks for: `DATABASE_URL` (from step 1), `SARVAM_API_KEY`, `GEMINI_API_KEY`.
4. Deploy. First build takes 5–10 minutes. Database migrations run automatically on start.

Your app: `https://voice-dukan.onrender.com`. It is HTTPS, so phone microphones work.

## 4. First run

Open the URL, create your shop, then add stock: **Inventory → Import a CSV**
(`eval/data/catalog_medical.csv` or `catalog_kirana.csv` from this repo), or speak it.

## What free costs you

| Limit | Effect |
|---|---|
| 512 MB RAM, 0.1 CPU | Enough here: voice detection uses webrtcvad, not torch |
| Sleeps after 15 minutes idle | First visitor after a quiet spell waits about a minute |
| 750 instance hours a month | Enough for one always-available service |
| No permanent disk | Recorded audio is temporary; bills, stock and corrections live in Neon |
| Neon 0.5 GB | Hundreds of thousands of bills |

Gemini's free tier allows 15 requests a minute and 1,000 a day, and Google may use that data to improve
its products. Move to a billed Gemini key before real customer bills go through.

## Keeping it awake (optional)

A free pinger such as <https://cron-job.org> calling `/api/health` every 10 minutes during shop hours
keeps it warm. It spends the same 750 monthly hours, so schedule it 8am–10pm, not all night.
