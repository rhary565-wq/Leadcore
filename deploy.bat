@echo off
REM Deploys backend + frontend to Google Cloud Run (asia-southeast1).
REM Before the first run: gcloud auth login, and fill backend\.env + frontend\.env
setlocal
set REGION=asia-southeast1
for /f %%p in ('gcloud config get-value project') do set GCP_PROJECT=%%p
if not exist backend\env.yaml (echo Copy backend\env.yaml.example to backend\env.yaml and fill it in first. & exit /b 1)
for /f "tokens=1,* delims==" %%a in (frontend\.env) do set %%a=%%b

echo === Backend ===
gcloud run deploy leadcore-backend --source backend --region %REGION% --allow-unauthenticated --env-vars-file backend\env.yaml || goto :err

echo === Frontend ===
gcloud builds submit frontend --region %REGION% --config frontend\cloudbuild.yaml --substitutions=_VITE_API_URL=%VITE_API_URL%,_VITE_SUPABASE_URL=%VITE_SUPABASE_URL%,_VITE_SUPABASE_ANON_KEY=%VITE_SUPABASE_ANON_KEY% || goto :err
gcloud run deploy leadcore-frontend --image gcr.io/%GCP_PROJECT%/leadcore-frontend --region %REGION% --allow-unauthenticated || goto :err
echo Done.
goto :eof
:err
echo Deploy failed.
exit /b 1
