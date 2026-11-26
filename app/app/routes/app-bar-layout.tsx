import { Outlet } from "react-router";

import { AppBar } from "~/components/app-bar";
import { NotificationList } from "~/components/notification-list";
import { CardLayout } from "~/components/ui/card-layout";

export default function AppBarLayout() {
  return (
    <CardLayout cardClassName="gap-2 overflow-hidden pb-0 sm:max-h-dvh sm:pb-0">
      <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto">
        <NotificationList />
        <Outlet />
      </main>
      <AppBar />
    </CardLayout>
  );
}
