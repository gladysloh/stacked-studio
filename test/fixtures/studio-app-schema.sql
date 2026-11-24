CREATE TABLE generation (
    id text primary key,
    created_at text not null,
    instruction text,
    prompt text not null,
    provider text not null,
    model text not null,
    params text not null default '{}',
    agent_name text,
    agent_version text,
    status text not null default 'done' check (status in ('done', 'failed')),
    is_test integer not null default 0
  , parent_id text references generation (id), fork_of_id text references generation (id), root_id text, version integer not null default 1, change_note text, cost_usd real not null default 0, error text, request_id text, run_id text, client_id text references client (id), deliverable_id text references deliverable (id), concept_id text references concept (id));
CREATE TABLE asset (
    hash text primary key,
    mime text not null,
    bytes integer not null,
    created_at text not null
  , width integer, height integer);
CREATE TABLE generation_output (
    generation_id text not null references generation (id) on delete cascade,
    idx integer not null,
    asset_hash text not null references asset (hash),
    primary key (generation_id, idx)
  );
CREATE TABLE generation_input (
    generation_id text not null references generation (id) on delete cascade,
    idx integer not null,
    kind text not null check (kind in ('reference')),
    asset_hash text not null references asset (hash),
    note text,
    original_name text,
    primary key (generation_id, idx)
  );
CREATE TABLE client (
    id text primary key,
    name text not null,
    industry text not null default '',
    website text not null default '',
    description text not null default '',
    created_at text not null,
    updated_at text not null,
    archived integer not null default 0
  );
CREATE TABLE knowledge_item (
    id text primary key,
    client_id text not null references client (id) on delete cascade,
    kind text not null check (kind in ('brand', 'tone', 'products', 'audience', 'campaign', 'preference', 'other')),
    title text not null,
    created_at text not null
  );
CREATE TABLE knowledge_version (
    id text primary key,
    item_id text not null references knowledge_item (id) on delete cascade,
    version integer not null,
    body text not null,
    note text,
    source text,
    status text not null default 'draft' check (status in ('draft', 'approved', 'replaced')),
    created_at text not null,
    created_by text,
    approved_at text,
    unique (item_id, version)
  );
CREATE TABLE deck (
    id text primary key,
    client_id text not null references client (id) on delete cascade,
    title text not null,
    source text not null default 'google_slides',
    source_id text,
    source_url text,
    modified_at text,
    imported_at text not null,
    file_hash text references asset (hash),
    slide_count integer,
    full_text text
  , synced_at text);
CREATE TABLE deck_slide (
    deck_id text not null references deck (id) on delete cascade,
    idx integer not null,
    title text,
    body text,
    notes text,
    primary key (deck_id, idx)
  );
CREATE TABLE deck_comment (
    id text primary key,
    deck_id text not null references deck (id) on delete cascade,
    source_id text,
    parent_id text,
    slide integer,
    author text,
    body text not null,
    quoted text,
    resolved integer not null default 0,
    created_at text,
    imported_at text not null
  , asset_code text);
CREATE TABLE generation_context (
    generation_id text not null references generation (id) on delete cascade,
    kind text not null check (kind in ('knowledge', 'skill')),
    ref_id text not null,
    label text not null,
    version text,
    primary key (generation_id, kind, ref_id)
  );
CREATE TABLE deck_revision (
    deck_id text not null references deck (id) on delete cascade,
    source_id text not null,
    modified_at text,
    author text,
    primary key (deck_id, source_id)
  );
CREATE TABLE project (
    id text primary key,
    client_id text not null references client (id) on delete cascade,
    name text not null,
    brief text not null default '',
    deck_id text references deck (id) on delete set null,
    created_at text not null,
    updated_at text not null,
    archived integer not null default 0
  );
CREATE TABLE deliverable (
    id text primary key,
    project_id text not null references project (id) on delete cascade,
    code text not null,
    status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'review', 'approved')),
    created_at text not null,
    updated_at text not null,
    unique (project_id, code)
  );
CREATE TABLE deliverable_messaging (
    id text primary key,
    deliverable_id text not null references deliverable (id) on delete cascade,
    created_at text not null,
    source text not null check (source in ('deck', 'studio', 'agent')),
    campaign text,
    product text,
    key_message text,
    super text,
    remarks text,
    description text,
    deck_iterations integer
  );
CREATE TABLE concept (
    id text primary key,
    deliverable_id text not null references deliverable (id) on delete cascade,
    name text not null,
    note text,
    created_at text not null,
    archived integer not null default 0
  );
CREATE TABLE IF NOT EXISTS "client_asset" (
    id text primary key,
    client_id text not null references client (id) on delete cascade,
    kind text not null check (kind in ('product', 'talent', 'reference', 'logo', 'document', 'past_work')),
    asset_hash text not null references asset (hash),
    name text,
    note text,
    created_at text not null,
    archived integer not null default 0,
    source text
  , style text check (style in ('packshot', 'group', 'angles', 'lifestyle')), label_text text);
CREATE TABLE deliverable_file (
    deliverable_id text not null references deliverable (id) on delete cascade,
    asset_hash text not null references asset (hash),
    slide integer,
    name text,
    created_at text not null, role text not null default 'other',
    primary key (deliverable_id, asset_hash)
  );
CREATE TABLE deliverable_slide (
    deliverable_id text not null references deliverable (id) on delete cascade,
    slide integer not null,
    label text,
    creative_idea text,
    description text,
    lighting text,
    palette text not null default '[]',
    created_at text not null,
    primary key (deliverable_id, slide)
  );
CREATE TABLE IF NOT EXISTS "feedback" (
    id text primary key,
    generation_id text not null references generation (id) on delete cascade,
    created_at text not null,
    kind text not null check (kind in ('approval', 'rating', 'comment', 'like')),
    value text,
    body text
  );
CREATE TABLE deliverable_like (
    deliverable_id text not null references deliverable (id) on delete cascade,
    asset_hash text not null,
    liked integer not null,
    created_at text not null,
    primary key (deliverable_id, asset_hash)
  );
CREATE TABLE compose_layout (
    generation_id text primary key references generation (id) on delete cascade,
    deliverable_id text references deliverable (id) on delete cascade,
    data text not null,
    layout_hash text,
    scene text,
    created_at text not null
  );
CREATE TABLE image_check (
    id text primary key,
    generation_id text not null references generation (id) on delete cascade,
    created_at text not null,
    status text not null check (status in ('pass', 'issues')),
    summary text,
    issues text not null default '[]',
    labels_read text not null default '[]',
    run_id text
  );
CREATE TABLE IF NOT EXISTS "agent_run" (
    id text primary key,
    created_at text not null,
    kind text not null check (kind in ('new', 'refine', 'direction', 'sync', 'prompt', 'check', 'label', 'learn')),
    text text not null,
    target_id text references generation (id),
    settings text not null default '{}',
    agent text,
    status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'stopped', 'waiting')),
    session_id text,
    steps text not null default '[]',
    message text,
    started_at text,
    finished_at text,
    client_id text references client (id),
    deck_id text references deck (id) on delete cascade,
    deliverable_id text references deliverable (id),
    concept_id text references concept (id),
    result text
  );
