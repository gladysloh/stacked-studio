# Google Drive, Slides and Sheets

The studio works without Google. Connecting it adds:

- **Drive as the shared library.** Search a client's Drive folder by file name, folder and description, and download only what you use.
- **Save to Drive.** Approved images go to `<client folder>/Studio/<project>/`, and the Drive link is kept in the image's history.
- **Slides.** Import or re-sync a deck's text, speaker notes and every comment thread.
- **Sheets.** Read shot lists or batch inputs, and write status and links back.
- **Client packs on Drive.** `studio client export <client> --drive`, then `studio client import <Drive link>`.

## Recommended layout: one Shared Drive

```
Shared Drive "Studio"
├── _client-packs/          zips made by `studio client export --drive`
├── Acme/                   one folder per client (made by `studio drive init acme`)
│   ├── Brand guidelines/
│   ├── Products/
│   ├── Decks/
│   └── Studio/<project>/   images saved by the studio
└── …
```

A Shared Drive belongs to the team, so files stay when people leave. Access can be given per client folder, for example to a freelancer.

## One-time setup (team owner, about 10 minutes)

1. **Google Cloud project.** Use your Workspace organisation's project, or create one at https://console.cloud.google.com.
2. **Enable the APIs.** Turn on the Google Drive API, Google Slides API and Google Sheets API (APIs & Services → Library).
3. **Consent screen.** In APIs & Services → OAuth consent screen, choose User type **Internal**. Only people in your Workspace can sign in, and Google doesn't need to review the app. Give it an app name such as "Studio".
4. **Sign-in client.** In APIs & Services → Credentials → Create credentials → OAuth client ID, choose Application type **Desktop app**. Copy the client ID and client secret. For desktop apps Google doesn't treat these as secret, so they can go in the team pack. They are not API keys.
5. **Shared Drive.** Create the Shared Drive and copy its id from the URL (`https://drive.google.com/drive/folders/<id>`).
6. **Team pack.** Put `team.yaml` (see `docs/team-pack.example.yaml`) in a zip and share it privately with the team, for example in the Shared Drive itself.

## Each teammate

```sh
studio team import team-pack.zip
studio connect google          # opens the browser; sign in with your work account
studio doctor                  # "Google Drive  connected as you@company.com"
```

Your sign-in is stored in your keychain. `studio disconnect google` removes it and revokes it with Google.

## Per client

```sh
studio drive init acme                     # creates or reuses "Acme" in the Shared Drive
# or point at an existing folder:
studio drive link acme https://drive.google.com/drive/folders/<id>
studio drive index acme                    # makes the files searchable (downloads nothing)
studio deck import acme <Slides link>      # deck text, notes and comments
```

Run `studio drive index` again whenever the folder changes a lot. It only re-lists the files.

## Keeping clients in sync across the team

```sh
studio client sync acme
```

Each client has one shared copy on the Shared Drive (`_client-packs/acme.zip`). Sync pulls it, merges it with yours, and pushes the result:
- **Comments, approvals and history** (the `.jsonl` logs) always merge.
- **A file only one person changed** takes that person's version.
- **A file both people changed** is flagged. The other version is saved next to yours as `<file>.incoming`, and nothing is pushed until you've kept the right one and deleted the `.incoming` file.

Images aren't in the shared copy: approved ones live in the client's Drive folder (`drive_save`), and product photos travel with the client.

## Read-only folders (e.g. working decks)

Some material lives outside the Shared Drive, in folders the studio should only read. Working decks are the usual example:

```sh
studio drive link acme <folder link> --read-only
studio drive index acme                    # indexes both the client folder and the read-only ones
studio deck import acme <Slides link>      # the first time; then `studio deck import acme` re-syncs all linked decks
```

The studio searches and downloads from read-only folders, but never saves to them. It refuses if asked to.
