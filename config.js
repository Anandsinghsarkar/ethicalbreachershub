// Firebase Web config is safe to use in browser code.
// NEVER put Razorpay Key Secret or Firebase service-account private key here.
window.A7_CONFIG = {
  firebase: {
    apiKey: "AIzaSyAsGtblJRafRcfPDxSwXIlklMqBSKfo8Eo",
    authDomain: "asprivetchat.firebaseapp.com",
    databaseURL: "https://asprivetchat-default-rtdb.asia-southeast1.firebasedatabase.app",
    projectId: "asprivetchat",
    storageBucket: "asprivetchat.firebasestorage.app",
    messagingSenderId: "232125473382",
    appId: "1:232125473382:web:ae3aa39cfd9febc92803a7",
    measurementId: "G-8LXNRN5SX4"
  },

  // Vercel Serverless backend is mounted under /api.
  backendBase: window.location.origin + "/api"
};
