A7 TOOLS HUB - VERCEL DEPLOY
============================

1) Is ZIP ko extract karo.
2) GitHub me ZIP ke andar A7_Tools_Hub_VERCEL folder ki SAARI files upload karo.
   GitHub repo root me index.html, api/, backend-core.js, vercel.json dikhna chahiye.
3) Vercel > Add New > Project > GitHub repo Import.
4) Framework Preset: Other
5) Root Directory: agar files repo root me hain to blank/root hi rakho.
6) Build Command: blank
7) Output Directory: blank
8) Deploy karo.

DEPLOY KE BAAD ENVIRONMENT VARIABLES
-----------------------------------
Vercel Project > Settings > Environment Variables me add karo:

FIREBASE_SERVICE_ACCOUNT_JSON = Firebase ki NEW service-account JSON ka poora content
RAZORPAY_KEY_ID = current Razorpay Key ID
RAZORPAY_KEY_SECRET = NEW/rotated Key Secret
RAZORPAY_WEBHOOK_SECRET = Razorpay webhook setup wala exact secret
ALLOWED_ORIGIN = https://YOUR-PROJECT.vercel.app
DAILY_CLAIM_CREDITS = 5

Environment Variables save karne ke baad Deployments > latest deployment > Redeploy karo.

RAZORPAY WEBHOOK
----------------
Vercel domain milne ke baad Razorpay webhook URL:
https://YOUR-PROJECT.vercel.app/api/razorpay/webhook

Active event: payment.captured
Webhook secret Vercel ke RAZORPAY_WEBHOOK_SECRET se EXACT same hona chahiye.

IMPORTANT
---------
- Purani exposed Firebase service-account private key aur Razorpay Key Secret reuse mat karo; rotate/revoke karke new credentials use karo.
- Firebase service-account JSON, Razorpay Key Secret, webhook secret GitHub me upload mat karo.
- firebase-rtdb-rules.json ko Firebase Realtime Database > Rules me paste/publish karo (Firestore Rules me nahi).
- Firebase Authentication > Sign-in method > Email/Password ON rakho.
- Razorpay Live payment ke liye Vercel domain ko Razorpay Website/App Details me add karke approval lena padega.

TEST
----
https://YOUR-PROJECT.vercel.app/api/health
Expected: success:true

Frontend root:
https://YOUR-PROJECT.vercel.app/


ADMIN SETUP (FIRST ACCOUNT ADMIN REMOVED)
------------------------------------------
Vercel > Project > Settings > Environment Variables me:
ADMIN_EMAIL = jis email ko admin banana hai
ADMIN_PASSWORD = us Firebase account ka password

IMPORTANT:
- ADMIN_EMAIL wala account Firebase Authentication me isi email se hona chahiye.
- ADMIN_PASSWORD ko frontend me expose nahi kiya jata. Firebase login password verify karta hai.
- Backend admin permission sirf ADMIN_EMAIL ke authenticated Firebase user ko deta hai.
- First registered account ab admin nahi banta.
- ADMIN_EMAIL badalne ke baad redeploy karein aur naye admin email se login karein.

FORGOT PASSWORD
---------------
Login screen par Forgot password? dabayein. Sirf email ID required hai. Firebase us email par password-reset link bhejega. Firebase Console > Authentication > Sign-in method me Email/Password enabled hona chahiye.

Security note: Agar admin password reset karte hain to Vercel ADMIN_PASSWORD ko bhi new password se update rakhein, although server authorization email + valid Firebase session se hota hai.


GOOGLE LOGIN SETUP (IMPORTANT)
==============================
1. Firebase Console > Authentication > Sign-in method.
2. Google provider ko Enable karein.
3. Project support email select karke Save karein.
4. Authentication > Settings > Authorized domains me apna Vercel domain add/confirm karein.
5. Website par "Continue with Google" direct popup login button work karega.

RESULT VIEWER UPDATE
====================
- Long pages/panels/modals mobile + desktop par scrollable hain.
- Tool result ke andar vertical + horizontal touch scroll hai.
- Result line-by-line icon format me render hota hai.
- Copy + JSON Download buttons included hain.
- SPIN feature frontend/backend/database rules se remove kiya gaya hai.
