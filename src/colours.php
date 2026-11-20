<?php
// The colours of an organization's or a mailing list's email: a foreground (the name, label, button and links) and two
// backgrounds (the page behind the card, and the band at the bottom). Stored as "#fg,#bg1,#bg2", or '' for the default.
declare(strict_types=1);

const MAIL_COLOURS = ['fg' => '#3d5e2b', 'bg1' => '#f4f1e8', 'bg2' => '#e9edc9'];

function colour_presets(): array
{
    return [
        'agenda'  => ['agenda.delivery', '#3d5e2b', '#f4f1e8', '#e9edc9'],
        'harbour' => ['Harbour', '#1f4e79', '#eef3f8', '#d6e4f0'],
        'brick'   => ['Brick', '#8a3324', '#f7efe9', '#f0d9cf'],
        'plum'    => ['Plum', '#5b3a6b', '#f4eff6', '#e5d8ec'],
        'slate'   => ['Slate', '#334155', '#f1f5f9', '#e2e8f0'],
    ];
}

// The colours a stored value stands for, the default when it's empty or broken.
function mail_colours(string $stored): array
{
    $c = explode(',', strtolower($stored));
    return count($c) === 3 && count(array_filter($c, fn($x) => preg_match('/^#[0-9a-f]{6}$/', $x))) === 3
        ? array_combine(['fg', 'bg1', 'bg2'], $c) : MAIL_COLOURS;
}

// Checks colours sent from a form (colour_fg, colour_bg1, colour_bg2) and returns [the value to store, null] or
// [null, what's wrong]. The button's white text has to stay readable on the foreground, and the dark text of the
// email on both backgrounds, so pale foregrounds and dark backgrounds are turned away. The default stores as ''.
function check_colours(array $in): array
{
    $c = [];
    foreach (['fg', 'bg1', 'bg2'] as $k) {
        $v = strtolower(trim((string)($in["colour_$k"] ?? '')));
        if (!preg_match('/^#[0-9a-f]{6}$/', $v)) return [null, 'Pick each colour from the colour boxes.'];
        $c[$k] = $v;
    }
    if (contrast($c['fg'], '#ffffff') < 4.5) return [null, 'The foreground colour needs to be darker, so the white text on the button stays readable.'];
    foreach (['bg1' => 'first', 'bg2' => 'second'] as $k => $which) {
        if (contrast($c[$k], '#1c1b16') < 10) return [null, "The $which background needs to be lighter, so the text on it stays readable."];
    }
    return [$c === MAIL_COLOURS ? '' : implode(',', $c), null];
}

// The WCAG contrast ratio of two colours, from 1 to 21.
function contrast(string $a, string $b): float
{
    $lum = function (string $hex): float {
        $ch = array_map(fn($x) => hexdec($x) / 255, str_split(ltrim($hex, '#'), 2));
        $ch = array_map(fn($x) => $x <= 0.03928 ? $x / 12.92 : (($x + 0.055) / 1.055) ** 2.4, $ch);
        return 0.2126 * $ch[0] + 0.7152 * $ch[1] + 0.0722 * $ch[2];
    };
    [$hi, $lo] = [max($lum($a), $lum($b)), min($lum($a), $lum($b))];
    return ($hi + 0.05) / ($lo + 0.05);
}
