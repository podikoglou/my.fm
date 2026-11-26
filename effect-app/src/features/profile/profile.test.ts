import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator, Story } from "@effect/ui/testing";
import { describe, expect, test } from "bun:test";

import {
  formatScrobbleDate,
  monthAt,
  pagesBetween,
  ROW_HEIGHT,
  rowAddress,
  rowsInView,
  toMonths,
  totalPlays,
} from "./history-timeline";
import { HistoryTimelineMessage, HistoryTimelineNoDeps } from "./HistoryTimeline";
import { ProfilePageNoDeps } from "./ProfilePage";
import { ViewerSchema } from "./queries";
import { UserTrackListNoDeps } from "./UserTrackList";

const sampleMonths = toMonths([
  { month: "2026-04", count: 10 },
  { month: "2026-03", count: 20 },
]);

const sampleProfile = {
  id: "user-river",
  username: "river",
  name: "River Park",
  avatarUrl: null,
};

const ownerViewer = ViewerSchema.SignedIn({
  user: {
    id: "user-river",
    username: "river",
    name: "River Park",
    email: "river@example.com",
    avatarUrl: null,
    onboarded: true,
    isPrivate: false,
  },
});

const otherViewer = ViewerSchema.SignedIn({
  user: {
    id: "user-other",
    username: "alex",
    name: "Alex",
    email: "alex@example.com",
    avatarUrl: null,
    onboarded: true,
    isPrivate: false,
  },
});

const incompleteViewer = ViewerSchema.SignedIn({
  user: {
    id: "user-new",
    username: "newuser",
    name: "New User",
    email: "new@example.com",
    avatarUrl: null,
    onboarded: false,
    isPrivate: false,
  },
});

describe("history timeline math", () => {
  test("computes cumulative month offsets, total plays, and row addresses", () => {
    expect(totalPlays(sampleMonths)).toBe(30);
    expect(monthAt(sampleMonths, 0).key).toBe("2026-04");
    expect(monthAt(sampleMonths, 9).key).toBe("2026-04");
    expect(monthAt(sampleMonths, 10).key).toBe("2026-03");

    const addr = rowAddress(sampleMonths, 19);

    expect(addr.month.key).toBe("2026-03");
    expect(addr.page).toBe(1);
    expect(addr.slot).toBe(1);
  });

  test("computes overscanned rows and deduplicated pages", () => {
    const range = rowsInView(ROW_HEIGHT * 8, ROW_HEIGHT * 4, 30);

    expect(range).toEqual({ first: 6, last: 14 });

    const pages = pagesBetween(sampleMonths, range);

    expect(pages.map(({ month, page }) => `${month.key}:${page}`)).toEqual([
      "2026-04:0",
      "2026-04:1",
      "2026-03:0",
    ]);
  });

  test("formats today and older scrobble timestamps", () => {
    const now = new Date();

    expect(formatScrobbleDate(now, false)).toMatch(/^Today, /);

    const past = new Date(2025, 2, 14, 9, 30);

    expect(formatScrobbleDate(past, false)).not.toContain("Mar");
    expect(formatScrobbleDate(past, true)).toContain("Mar");
  });
});

describe("HistoryTimeline transitions", () => {
  test("holds settledTop during scroll and records loaded keys only once settled", () => {
    const story = Story.start(HistoryTimelineNoDeps, {
      username: "river",
      months: sampleMonths,
    });

    story.send(
      HistoryTimelineMessage.MeasuredViewport({
        viewportHeight: ROW_HEIGHT * 4,
        scrollHeight: ROW_HEIGHT * 30,
      }),
    );

    expect(story.model.loadedKeys).toEqual(["2026-04:10:0"]);

    story.keepPending("pages").send(
      HistoryTimelineMessage.ScrolledList({
        scrollTop: ROW_HEIGHT * 12,
        viewportHeight: ROW_HEIGHT * 4,
        scrollHeight: ROW_HEIGHT * 30,
      }),
    );

    expect(story.model.scrollTop).toBe(ROW_HEIGHT * 12);
    expect(story.model.settledTop).toBe(0);
    expect(story.model.scrolling).toBe(true);
    expect(story.model.loadedKeys).toEqual(["2026-04:10:0"]);

    story.send(HistoryTimelineMessage.SettledScroll({ settledTop: ROW_HEIGHT * 12 }));

    expect(story.model.settledTop).toBe(ROW_HEIGHT * 12);
    expect(story.model.loadedKeys).toContain("2026-03:20:0");
    expect(story.model.loadedKeys).toContain("2026-03:20:1");

    story.keepPending("pages").send(HistoryTimelineMessage.HidScrollLabel());
    expect(story.model.scrolling).toBe(false);
  });
});

describe("ProfilePage views", () => {
  test("renders Private Profile on private lookup error", () => {
    const scene = HtmlScene.start(ProfilePageNoDeps, { username: "secret" })
      .loadFailed("profile", "private")
      .loaded("viewer", ViewerSchema.Anonymous());

    scene
      .expect(Locator.text("Private Profile"))
      .toExist()
      .expect(Locator.text("This user's profile is private"))
      .toExist();
  });

  test("renders User Not Found on missing user", () => {
    const scene = HtmlScene.start(ProfilePageNoDeps, { username: "nobody" })
      .loadFailed("profile", "not_found")
      .loaded("viewer", ViewerSchema.Anonymous());

    scene.expect(Locator.text("User Not Found")).toExist();
  });

  test("renders Sign in for anonymous viewers and hides Settings", () => {
    const scene = HtmlScene.start(ProfilePageNoDeps, { username: "river" })
      .loaded("profile", sampleProfile)
      .loaded("viewer", ViewerSchema.Anonymous());

    scene
      .expect(Locator.text("River Park"))
      .toExist()
      .expect(Locator.text("@river"))
      .toExist()
      .expect(HtmlLocator.role("button", { name: "Sign in" }))
      .toExist()
      .expect(HtmlLocator.role("link", { name: "Settings" }))
      .toBeAbsent();
  });

  test("renders Settings link only when viewing own profile", () => {
    const ownerScene = HtmlScene.start(ProfilePageNoDeps, { username: "river" })
      .loaded("profile", sampleProfile)
      .loaded("viewer", ownerViewer);

    ownerScene
      .expect(HtmlLocator.role("link", { name: "Settings" }))
      .toExist()
      .expect(HtmlLocator.role("button", { name: "Sign in" }))
      .toBeAbsent();

    const otherScene = HtmlScene.start(ProfilePageNoDeps, { username: "river" })
      .loaded("profile", sampleProfile)
      .loaded("viewer", otherViewer);

    otherScene
      .expect(HtmlLocator.role("link", { name: "Settings" }))
      .toBeAbsent()
      .expect(HtmlLocator.role("button", { name: "Sign in" }))
      .toBeAbsent();
  });

  test("hides profile content while redirecting non-onboarded viewers", () => {
    const scene = HtmlScene.start(ProfilePageNoDeps, { username: "river" })
      .loaded("profile", sampleProfile)
      .loaded("viewer", incompleteViewer);

    scene.expect(Locator.text("River Park")).toBeAbsent();
  });
});

describe("UserTrackList views", () => {
  test("renders empty state when there are no scrobble months", () => {
    const scene = HtmlScene.start(UserTrackListNoDeps, { username: "quiet" }).loaded("months", []);

    scene.expect(Locator.text("No scrobbles yet.")).toExist();
  });

  test("renders error state when scrobble months fail", () => {
    const scene = HtmlScene.start(UserTrackListNoDeps, { username: "broken" }).loadFailed(
      "months",
      "Couldn't load scrobble months",
    );

    scene.expect(Locator.text("Couldn't Find Scrobbles")).toExist();
  });
});
