"use client";

// The village (Home), its rooms and the login page are full-screen worlds
// with their own top bars. The old Command Center pages are retired: their
// addresses redirect to the matching rooms.
export default function AppShell({ children }: { children: React.ReactNode }) {
  return <div className="h-screen w-screen overflow-hidden">{children}</div>;
}
