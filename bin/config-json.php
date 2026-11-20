<?php
// Prints every setting as JSON for the agenda delivery service, and makes sure the database schema is current.
declare(strict_types=1);
require __DIR__ . '/../src/app.php';
db();
echo json_encode(cfg(null) + ['root' => realpath(ROOT)], JSON_UNESCAPED_SLASHES);
