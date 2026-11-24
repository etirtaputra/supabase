import { redirect } from 'next/navigation';

/** Renamed 2026-11-24 (owner: "rename quick quote to residential") — old links and bookmarks land on the new address. */
export default function QuickQuoteMoved() {
  redirect('/proposals/residential');
}
