<?php
// Pure helpers behind adtool: page-to-text, captions-to-text and transcript name correction.
declare(strict_types=1);

// Readable text plus every link and frame on the page, links made absolute.
function html_to_text(string $html, string $base): array
{
    $doc = new DOMDocument();
    libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="utf-8"?>' . $html, LIBXML_NONET);
    libxml_clear_errors();
    foreach (['script', 'style', 'noscript', 'svg', 'template'] as $tag) {
        foreach (iterator_to_array($doc->getElementsByTagName($tag)) as $n) $n->parentNode->removeChild($n);
    }
    // Links in the page's own content come first and menus last, since only the first links get listed.
    $links = $menuLinks = [];
    $xpath = new DOMXPath($doc);
    foreach (['a' => 'href', 'iframe' => 'src', 'frame' => 'src'] as $tag => $attr) {
        foreach ($doc->getElementsByTagName($tag) as $a) {
            $href = trim($a->getAttribute($attr));
            if ($href === '' || preg_match('#^(javascript:|mailto:|tel:|\#)#i', $href)) continue;
            $label = trim(preg_replace('/\s+/', ' ', $a->textContent ?: $a->getAttribute('title') ?: $a->getAttribute('aria-label')));
            $abs = absolute_url($href, $base);
            $inMenu = $xpath->query('ancestor::nav|ancestor::header|ancestor::footer|ancestor::*[@role="navigation"]', $a)->length > 0;
            if ($inMenu) $menuLinks[$abs] ??= mb_substr($label, 0, 120);
            else $links[$abs] ??= ($tag === 'a' ? '' : '[frame] ') . mb_substr($label, 0, 120);
        }
    }
    $links += $menuLinks;
    $body = $doc->getElementsByTagName('body')->item(0);
    $text = trim(preg_replace(['/[ \t\x{a0}]+/u', '/\s*\n\s*/'], [' ', "\n"], $body ? $body->textContent : ''));
    return [$text, $links];
}

function absolute_url(string $href, string $base): string
{
    if (preg_match('#^https?://#i', $href)) return $href;
    $b = parse_url($base);
    $root = ($b['scheme'] ?? 'https') . '://' . ($b['host'] ?? '') . (isset($b['port']) ? ':' . $b['port'] : '');
    if (str_starts_with($href, '//')) return ($b['scheme'] ?? 'https') . ':' . $href;
    if (str_starts_with($href, '/')) return $root . $href;
    if (str_starts_with($href, '?')) return $root . ($b['path'] ?? '/') . $href;
    $dir = preg_replace('#/[^/]*$#', '/', $b['path'] ?? '/');
    $path = $dir . $href;
    // Resolve ./ and ../ segments.
    $out = [];
    foreach (explode('/', $path) as $seg) {
        if ($seg === '..') array_pop($out);
        elseif ($seg !== '.') $out[] = $seg;
    }
    return $root . implode('/', $out);
}

// WebVTT captions to plain text. Auto captions repeat each line as the next one rolls in, so repeats are dropped.
function vtt_to_text(string $vtt): string
{
    $out = [];
    $last = '';
    foreach (preg_split('/\R/', $vtt) as $line) {
        $line = trim(html_entity_decode(strip_tags(preg_replace('/<[\d:.]+>/', '', $line))));
        if ($line === '' || $line === 'WEBVTT' || str_contains($line, '-->') || preg_match('/^(Kind|Language|NOTE)\b|^\d+$/', $line)) continue;
        if ($line === $last) continue;
        $out[] = $line;
        $last = $line;
    }
    return implode(' ', $out);
}

// Auto captions mangle surnames ("Councillor Fergusen"). After a title or a member's first name,
// swap the next word for the closest member surname when it is close enough.
// ponytail: only corrects names that follow a title or first name; bare surnames mid-sentence stay as captioned
function correct_names(string $text, array $members): string
{
    $surnames = [];
    $firsts = [];
    foreach ($members as $full) {
        $parts = preg_split('/\s+/', trim($full));
        if (count($parts) < 2) continue;
        $surnames[] = end($parts);
        $firsts[] = preg_quote($parts[0], '/');
    }
    if (!$surnames) return $text;
    $titles = 'Councillor|Councilor|Coun\.?|Mayor|Trustee|Director|Chair|Vice[- ]Chair|Deputy Mayor';
    $lead = $titles . ($firsts ? '|' . implode('|', $firsts) : '');
    return preg_replace_callback("/\\b($lead)\\s+([A-Za-z'][A-Za-z'-]{2,})\\b/i", function ($m) use ($surnames) {
        $word = $m[2];
        $best = null;
        $bestD = PHP_INT_MAX;
        foreach ($surnames as $s) {
            $d = levenshtein(strtolower($word), strtolower($s));
            if ($d < $bestD) { $best = $s; $bestD = $d; }
            if (metaphone($word) === metaphone($s) && $d <= 3) { $best = $s; $bestD = 0; break; }
        }
        return $m[1] . ' ' . ($bestD <= max(1, intdiv(strlen($best), 3)) ? $best : $word);
    }, $text);
}

// Splits long output into pages so the agent reads it a piece at a time.
function page_of(string $text, int $page, int $size = 12000): string
{
    $pages = max(1, (int)ceil(mb_strlen($text) / $size));
    $page = min(max(1, $page), $pages);
    $chunk = mb_substr($text, ($page - 1) * $size, $size);
    return $chunk . ($pages > 1 ? "\n\n[page $page of $pages, add --page N for more]" : '');
}

// The model doesn't always quote, so "--title Tree Bylaw Review --status third reading" arrives as separate
// words. An option's value runs to the next --option. The command, the URL (or link handle) and a pending
// item's key stay positional.
function parse_args(array $argv): array
{
    $out = ['_' => []];
    $key = null;
    foreach ($argv as $i => $word) {
        if (str_starts_with($word, '--')) {
            $key = substr($word, 2);
            $out[$key] = true;
        } elseif ($key === null || (count($out['_']) < 2 && preg_match('#^(https?://|L\d+$)#i', $word))) {
            $out['_'][] = $word;
        } else {
            $out[$key] = $out[$key] === true ? $word : $out[$key] . ' ' . $word;
        }
    }
    return $out;
}
