/**
 * WHAT A PHOTO COLUMN TAKES, judged on the phone the moment a photo is
 * picked, so a kind the server will refuse (an iPhone's HEIC that this
 * browser cannot draw again as a JPEG) is never kept on the phone, never
 * queued, and the field says so at once, in the person's language.
 *
 * The kinds are the manifest's own (`rules.file.accept` of each column;
 * `photoKinds.test.ts` holds them to it). The staff config does not carry a
 * column's file rule, and the whole manifest is far too large to ship to a
 * phone for five short lists.
 *
 * The photo field draws every picture it can open again as a JPEG before it
 * sends it, so what is judged is what would be sent: a HEIC that Safari can
 * open goes as a JPEG and is taken. A file whose kind the browser does not
 * say is judged by its name's ending; one with neither is left to the server,
 * which judges every file by its bytes.
 */

/** The server's names for the kinds a picture column may take (`FILE_COLUMN_KINDS`' pictures). */
export type PhotoKind = "png" | "jpeg" | "webp" | "gif";

/** Each file column the crew's and the fleet's phone screens send to, by `table.column`: its `rules.file.accept`. */
export const FILE_COLUMN_ACCEPT: Readonly<Record<string, readonly PhotoKind[]>> = {
  "sign_offs.photos": ["jpeg", "png", "webp"],
  "sign_offs.signature": ["png"],
  "snags.photo": ["jpeg", "png", "webp"],
  "snags.put_right_photo": ["jpeg", "png", "webp"],
  "vehicle_faults.photo": ["jpeg", "png", "webp"],
};

const TYPES: Readonly<Record<PhotoKind, readonly string[]>> = {
  png: ["image/png"],
  jpeg: ["image/jpeg", "image/jpg", "image/pjpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
};

const ENDINGS: Readonly<Record<PhotoKind, readonly string[]>> = {
  png: ["png"],
  jpeg: ["jpg", "jpeg", "jpe", "jfif"],
  webp: ["webp"],
  gif: ["gif"],
};

/**
 * Whether a file a column is about to be sent may go: `false` only when its
 * kind (or, the kind unsaid, its name's ending) is known and the column does
 * not take it. A column not listed here is left to the server.
 */
export function columnTakes(column: string, contentType: string | null | undefined, filename: string | null | undefined): boolean {
  const accept = FILE_COLUMN_ACCEPT[column];
  if (accept === undefined) return true;
  const type = (contentType ?? "").split(";")[0]!.trim().toLowerCase();
  if (type !== "" && type !== "application/octet-stream") return accept.some((kind) => TYPES[kind].includes(type));
  const dot = (filename ?? "").lastIndexOf(".");
  if (dot < 0) return true;
  const ending = (filename ?? "").slice(dot + 1).trim().toLowerCase();
  if (ending === "") return true;
  return accept.some((kind) => ENDINGS[kind].includes(ending));
}

/** A reply as the server gives a file of a kind it does not take: the photo field reads the status, and says it in its own words. */
export const wrongKindReply = (): Response =>
  new Response(JSON.stringify({ error: { code: "UNSUPPORTED_MEDIA_TYPE", message: "This kind of file is not taken by this column." } }), { status: 415, headers: { "content-type": "application/json" } });

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * A photo field's `fetch` that judges each upload before it goes on to
 * `next` (the offline queue's, which keeps it on the phone): a file of a kind
 * the column does not take is answered as the server would answer it, kept
 * nowhere, and `onRefused` is told. `onTaken` is told of one that goes on.
 */
export function judgedFetch(column: string, next: Fetch, onRefused: () => void, onTaken: () => void): Fetch {
  return (input, init) => {
    const url = new URL(input, "http://phone.invalid");
    if (url.pathname !== "/api/v1/files" || (init?.method ?? "GET").toUpperCase() !== "POST") return next(input, init);
    const body = init?.body;
    const declared = new Headers(init?.headers).get("content-type");
    const type = body instanceof Blob && body.type !== "" ? body.type : declared;
    if (!columnTakes(column, type, url.searchParams.get("filename"))) {
      onRefused();
      return Promise.resolve(wrongKindReply());
    }
    onTaken();
    return next(input, init);
  };
}
