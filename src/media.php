<?php
// Logos that accounts and mailing lists put on their mail. Files live in data_dir/media under names made here,
// outside the web root, and are only ever served by serve_media().
declare(strict_types=1);

const LOGO_MAX_BYTES = 500 * 1024;
const LOGO_MAX_SIDE = 1200;
// The only kinds accepted, by what the file holds: [extension, content type].
const LOGO_TYPES = [IMAGETYPE_PNG => ['png', 'image/png'], IMAGETYPE_JPEG => ['jpg', 'image/jpeg'], IMAGETYPE_WEBP => ['webp', 'image/webp']];

function media_dir(): string { return rtrim((string)cfg('data_dir'), '/') . '/media'; }

// The file behind one of our own names, such as "3f9c0a1b2c3d4e5f6a7b8c9d.png". Null for anything else.
function media_path(string $name): ?string
{
    return preg_match('/^[a-f0-9]{24}\.(?:png|jpg|webp)$/', $name) ? media_dir() . '/' . $name : null;
}

function logo_url(string $name): string { return cfg('base_url') . '/media/' . $name; }

// Checks that a file is a PNG, JPEG or WebP of a sensible size, going by its contents and never its name or
// what the browser said it was. Returns [extension, null] or [null, what's wrong].
function check_logo(string $file): array
{
    $size = @filesize($file);
    if ($size === false || $size === 0) return [null, "The logo didn't arrive. Try again."];
    if ($size > LOGO_MAX_BYTES) return [null, 'That file is too big. A logo can be up to 500 KB.'];
    $info = @getimagesize($file);
    $type = LOGO_TYPES[$info[2] ?? 0] ?? null;
    if (!$info || !$type || (new finfo(FILEINFO_MIME_TYPE))->file($file) !== $type[1]) return [null, 'A logo needs to be a PNG, JPEG or WebP image.'];
    if ($info[0] < 1 || $info[1] < 1 || max($info[0], $info[1]) > LOGO_MAX_SIDE) return [null, 'That image is too large. A logo can be up to ' . LOGO_MAX_SIDE . ' pixels on its longer side.'];
    return [$type[0], null];
}

// Keeps a checked copy of $file under a random name. Returns [the name, null] or [null, what's wrong].
function save_logo(string $file): array
{
    [$ext, $err] = check_logo($file);
    if ($err) return [null, $err];
    if (!is_dir(media_dir())) mkdir(media_dir(), 0750, true);
    $name = bin2hex(random_bytes(12)) . '.' . $ext;
    if (!copy($file, media_dir() . '/' . $name)) return [null, "The logo couldn't be saved. Try again."];
    chmod(media_dir() . '/' . $name, 0640);
    return [$name, null];
}

function delete_logo(string $name): void
{
    $path = media_path($name);
    if ($path && is_file($path)) unlink($path);
}

// Applies a settings form's logo field to an account ("user") or a mailing list ("target"): a new upload replaces
// the logo, the remove box clears it, and either way the old file goes. Returns null, or what's wrong.
function update_logo(string $table, int $id, int $uid, ?array $upload, bool $remove): ?string
{
    if (!in_array($table, ['user', 'target'], true)) return 'Nothing to change.';
    $old = (string)val("SELECT logo FROM $table WHERE id = ?", [$id]);
    $sent = $upload && ($upload['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE;
    if (!$sent) {
        if ($remove && $old !== '') { q("UPDATE $table SET logo = '' WHERE id = ?", [$id]); delete_logo($old); }
        return null;
    }
    if (in_array($upload['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true)) return 'That file is too big. A logo can be up to 500 KB.';
    if ($upload['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($upload['tmp_name'])) return "The logo didn't arrive. Try again.";
    if (too_many("logo:$uid", 10, 3600)) return "That's a lot of logos in an hour. Wait a little and try again.";
    [$name, $err] = save_logo($upload['tmp_name']);
    if ($err) return $err;
    q("UPDATE $table SET logo = ? WHERE id = ?", [$name, $id]);
    delete_logo($old);
    return null;
}

// Sends a stored logo, or a 404. The content type comes from the kind we stored it as, and the headers keep a
// browser from treating it as anything but that image.
function serve_media(string $name): void
{
    $path = media_path($name);
    if (!$path || !is_file($path)) { http_response_code(404); header('Content-Type: text/plain; charset=utf-8'); echo 'Not found'; return; }
    $types = array_column(LOGO_TYPES, 1, 0);
    header('Content-Type: ' . $types[pathinfo($name, PATHINFO_EXTENSION)]);
    header('Content-Length: ' . filesize($path));
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'");
    header('Cache-Control: public, max-age=31536000, immutable');
    readfile($path);
}

// Removes logo files nothing points at any more, such as those of a removed account or list. Files under an hour
// old are left, in case their row is still being written. Returns how many were removed.
function sweep_media(): int
{
    $used = array_flip(array_merge(array_column(rows("SELECT logo FROM user WHERE logo != ''"), 'logo'), array_column(rows("SELECT logo FROM target WHERE logo != ''"), 'logo')));
    $n = 0;
    foreach (glob(media_dir() . '/*') ?: [] as $file) {
        if (isset($used[basename($file)]) || filemtime($file) > time() - 3600) continue;
        $n += @unlink($file) ? 1 : 0;
    }
    return $n;
}
