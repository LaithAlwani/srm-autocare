// Pulls Stitch HTML + screenshots into .stitch/ for design reference.
// Re-run to refresh: `node scripts/pull-stitch.mjs`
//
// URLs were captured from the Stitch MCP `list_screens` call for project
// 12552783457969128776 ("SRM Auto Care Platform").
// Signed Google contribution URLs may expire — if a download 404s, re-run
// the MCP `list_screens` and update the table below.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const STITCH_DIR = resolve(ROOT, ".stitch");
const PUBLIC_DIR = resolve(ROOT, "public");

const screens = [
  {
    slug: "home-desktop",
    title: "SRM Auto Care - Home",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sX2VkZDEwZjIxOWE2MDQ1OTg4MjI0ODgwMjhlZDM2MGNkEgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0uilXsjbEaH_1Ea6F1ZrTWZJFM5mQWK_owGYvnv6nymrV025DI5_o9G9iXf1-cMsIMOSaLYi6KFCEps1bwMSBYUZ3Hrn7W92xH96-lQXmAsSdoFOq8o2gznR36r2GktKfGxgA7bxS_a1QXnyRjrjLVKQRCb4KbZkogGmxmJ9yB2MEMnvehArzA7C-jyt6snuSM-JXr78Wy1HLepAt-JGLgZA5HoCiFDKz2-kY9mabaCwUx5JZPKNnpkcdgL6",
  },
  {
    slug: "services-desktop",
    title: "Services & Pricing",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sX2M3NjQzYjY1MTNkMjRhM2I4N2E5NGRhYzI2M2FhODA0EgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0uhTvHFtH8rO2tL-IQQzPLWKJRSnM-As2lAk0h0Wf4MMF9mMBRK5HSWb7o-GY-LdDVJcST48HlWgl6GN5_aOz9zcq1wRLxIpZ6csO6rKhi1tVNycY6t5jZgUYnYDbVeyiC5ND0SCUSM-m-J-pY4zgBFVvswckpGu02nF-V8QQbS-VB3wm9-9pvXrDAtnrKKYP02OvdEuwA_Xl864B18FLmoy4E_Faz01BqJCULuAVXMeCXI8N0yLyw9KE0I",
  },
  {
    slug: "gallery-desktop",
    title: "Results Gallery",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzhlOGQyYjM4MTFkMzRhNTZiZTRhMDU2OGFlM2FlNWNlEgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0ug4RbXGqRZRWFmXzM3JZmjYvsrAHsECM8z4HymkmeUC_EXOKMkJNdFLHsOSKVveNAxEJW4O-GOFZccqWBbYrOaunIydacPFzMvjM0uSTBbDYjbFEb4kegG8rRHYsE1i29wJnMrNweueDIAayfoy9FelNP7A2MuC_Wj5DLFFbe-8E6mMg4Qp5efeJPjq1l5yQEaha19il-I21Gi-VszC2JPcwoSn96ouUnFsQYKqOrn8DsBMEGpcvgG1jAI",
  },
  {
    slug: "book-desktop",
    title: "Book an Appointment",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzJiOTRjMTVjMDkzYjQ3MjViNmZlMWQxNjM1YjUzMmM2EgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0ujfyFEEOzvYKbD9nT-hsFs0tl4VWsUozwRkYald5_YLALXYj_XOIBHtG8lvYzYIXF_uk0y-gWHytCiIW8czV9dPHFI70fsFFqJ_0nsBjgdKYXQ7jNu49wT4SGEXZo816C5ZS89XUeCel_lsT2NE3IFb3XAhNLxv7Na17ZXAk06-60pCOTtb09OVOt7CLwuyyWABc-jUc976nT8ipDYwQLp-hBgLTPPqU9g2BF8xi5rxA4fj4EYU9jYqCM0",
  },
  {
    slug: "contact-desktop",
    title: "Contact & Location",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzkxMzdhMGMxYTJjMTQyOTRiMzdhOGYyN2FkOTA0NzVhEgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0uh-Hwc3Cb7sH121ClsgUHrVJiD4Y2AWCyS2g0L6zAPBNCaRdicxIvCnmOXQAAV-pCqg1e7WeENH3pK3-x8XcJptmyCHKe-E_C9q_4Jf648_WVpNQUUmCWG-eL9XPViwtOXlBwmBQBfs3n6kLK6ehhopNKoAMOv-xW26PRu4Jym2DXlHCqxCN6VehAIGgT_ok-u5yysKY3zJGpC2M0dqKSs67t6kziU3Xqh7x0L7T389yNB27Ge_X2SP1Dvx",
  },
  {
    slug: "customer-dashboard-desktop",
    title: "Customer Dashboard",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzRjZTQwYmI4NzAyNTRjODRhZDc4ZWU5NTRkMWE3NTlmEgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0uhzV0HINde65lmJ9lAXd5B9Q4nB1EfA4lv7ibNZz8FlWDb5Zv9dvXGpQRDoS_U0hzChwru1RgRA7kPzInx-xTQBn5q-VyTzlYzjYG8tqEe_Imya6zQcPWlsC7RsAobpq1NEXXGwAS06ff8FMgvqZ5tvN_yL62CbKJlwUdqNLZQoYqxyPE2nFoRk3_6e1wjH3dzlzx_uVNoANjp3qi5hgkkh9Ez4rCQ5bE43PBcy9r924_5gL7Ffn86ADx7E",
  },
  {
    slug: "login-desktop",
    title: "Login / Sign Up",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sX2RhNGM1Y2JlYjRhMTQ5Y2VhYTdkOWIzNzdmOGM3MTEwEgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0ujbFN69QQacFGDhyPEDASIAT0Z0KdDedcR7fAGXyA4g0ZQRPPbnJIT52QikUUWhE0KT9lsl0c_llFbxHrK1_InYZEDRkcsp6rfv3jNqmoK1Vb3aF818TicW4NlKoYHlTqpKl7BSUT8jH3riHeEzsN1YOGE5QV8y9VZezJWwe6MUPt95autbZI_jDiTeCowdwU5_tmBa8NLwGj-yqeZ0iw-A6fi1AcQR4QFZZ3san_BIhv7ZQoGx7oUAObiF",
  },
  {
    slug: "home-mobile",
    title: "Home - Mobile",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sXzliMjQ5ZGUyN2YwMTRlMTdiNDU5ZTM5NWNmYjY2NmY5EgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0ugY5uKCSPGzwu17icjx0F-IqvGcnWWmw-SKLG3YWmfZK2hUjSWGdPTES09Jf0W5y-adQmb6xiUmUvUzm9_JoCBXcMGTQZYa44qolMXb06b4G0s0fZ0La0aF4ayarK3-uDugy9nAykz-CQJfDJvcaqQCCMZ4xBODTx8gNe2K9DNj003vSUkeTuqexsQTECKoEfPJrdXwo2FC28mHYzvsudJbRqt4FUVM9tYERQvWLzCFvQGkfrJKGOB0j5Mb",
  },
  {
    slug: "gallery-mobile",
    title: "Gallery - Mobile",
    html: "https://contribution.usercontent.google.com/download?c=CgthaWRhX2NvZGVmeBJ8Eh1hcHBfY29tcGFuaW9uX2dlbmVyYXRlZF9maWxlcxpbCiVodG1sX2YzZDQ0MWM0ZWRmMDQ1YzJhNDJiYzBjZGVhMWI4OTA3EgsSBxDj69HK5hIYAZIBJAoKcHJvamVjdF9pZBIWQhQxMjU1Mjc4MzQ1Nzk2OTEyODc3Ng&filename=&opi=89354086",
    png: "https://lh3.googleusercontent.com/aida/ADBb0ujVqkNhG2d0lG9QO0NMawnDPZztSLQ0rT363mlhW9Gonw6VkzA4_OCsp_bvYeNG5fO2XN2MSOzuCZYHT-lzYE_XJ656aSrnYZy5d_09rQAa6ARl4MhOmI_6kcYhYOCUsnj9-pVexc-zBOXXdcHyDkXlAG4muhnx0jmYfaihobck9RBOnT8Q-dXVWH3bJwnTk8CsQfik9mxjXnT4M0XQHe2GUtN9-umXUo7z5rirOW3igWnEVxla9rtxQnzl",
  },
];

const logo = {
  slug: "logo",
  url: "https://lh3.googleusercontent.com/aida/ADBb0ujlkrqpFjStczPeEbBQwqlOSkSrEdLq4U05voHSdNUDPXFRPSq4z_AxW-7mfmfeoKqYwQqiGkMMFcAXChieFFkJjMfrvK76uxeRvpy9IxMz-ujAPYlGaeG8i1MdGhbE1v0q_ZTsxnxShUbRz_6P4WrsPHdGG2K4VoI1VyPyIuMVNsBwHgEe3-HRxFkjgoS3uODXnImuRW792MF4nm8UZvluwD8A1G9xuZjCh0eH0Aqtm5rgGyMbYcBcAFSa",
};

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`  → ${dest.replace(ROOT, "").replace(/\\/g, "/")} (${buf.length} bytes)`);
}

async function main() {
  await mkdir(STITCH_DIR, { recursive: true });
  await mkdir(PUBLIC_DIR, { recursive: true });

  console.log("Downloading Stitch screens...");
  for (const s of screens) {
    console.log(`- ${s.title}`);
    await download(s.html, resolve(STITCH_DIR, `${s.slug}.html`));
    await download(s.png, resolve(STITCH_DIR, `${s.slug}.png`));
  }

  console.log("Downloading logo...");
  await download(logo.url, resolve(PUBLIC_DIR, "logo.png"));

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
