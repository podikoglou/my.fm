import { FeedTrackList } from "~/components/feed-track-list";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";

export function meta() {
  return [{ title: "Feed · my.fm" }];
}

export default function FeedPage() {
  return (
    <>
      <CardHeader>
        <CardTitle className="text-3xl font-bold">Feed</CardTitle>
        <CardDescription className="mt-2">The latest scrobbles from everyone.</CardDescription>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <FeedTrackList />
      </CardContent>
    </>
  );
}
