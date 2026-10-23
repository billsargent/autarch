// Client-side: end the dashboard session and go to the login page.
export async function signOut() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.assign("/login");
}
