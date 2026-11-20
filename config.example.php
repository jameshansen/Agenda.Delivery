<?php
// Copy to config.php and fill in. config.php is gitignored.
return [
    'base_url'      => 'https://agenda.delivery',
    'data_dir'      => '/var/lib/agenda',          // SQLite db, agent homes, browser slots
    'mail_from'     => 'update@agenda.delivery',
    'admin_emails'  => ['you@example.com'],
    'mail_capture'  => '',                         // a file to append outgoing mail to instead of sending it, for development
    'timezone'      => 'America/Vancouver',        // daily and weekly digests go out by this clock
    'digest_hour'   => 7,                          // the hour of the day digests are sent, 0 to 23

    // Google sign-in. Redirect URI: {base_url}/auth/google/callback
    'google_id'     => '',
    'google_secret' => '',

    // Ollama Cloud. Agents use its native API, custom prompts its OpenAI-compatible /v1 one.
    // An application token from pushover.net, so accounts can add Pushover with just their user key.
    'pushover_token' => '',
    // WhatsApp destinations, each linked by scanning a code and run as a Baileys bridge by the service.
    'whatsapp'       => true,
    'whatsapp_max'   => 20,                     // across the whole site; each bridge uses about 120 MB
    'ollama_base'   => 'https://ollama.com',
    'ollama_key'    => '',
    'model'         => 'deepseek-v4.1-flash',

    // The agenda delivery service: agents run every six hours, each at its own offset within the hour.
    'service_socket'    => '/run/agenda-delivery/service.sock',
    'gateway_port_base' => 3200,                    // each organization's gateway listens on this plus its monitor id
    'agent_concurrency' => 2,                       // agent runs at once
    'run_timeout'       => 1800,                    // seconds one agent run may take
    'browser_slots'     => 2,                       // Chrome instances at once
    'browser_wait'      => 600,                     // seconds a job waits for its turn before giving up
    'nullclaw_bin'   => '/usr/local/bin/nullclaw',
    // Test councils (testcouncil/testcouncil.py) on loopback, which agents may read despite the private address.
    'test_sites'     => [],
    'python_bin'     => '/opt/agenda/venv/bin/python',
];
