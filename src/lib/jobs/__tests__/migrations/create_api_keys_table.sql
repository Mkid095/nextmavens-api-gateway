-- Migration: Create API Keys Table (Test Only)
-- Description: Creates the api_keys table for testing rotate_key job functionality
-- This is a simplified version for testing purposes only
-- Created: 2026-01-29
-- US-005: Implement Rotate Key Job - Step 7: Integration Tests

-- Create api_keys table
CREATE TABLE IF NOT EXISTS control_plane.api_keys (
    -- Primary key
    id SERIAL PRIMARY KEY,

    -- Key information
    project_id INTEGER NOT NULL,
    key_type TEXT NOT NULL DEFAULT 'api',
    key_prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL,

    -- Key configuration
    scopes TEXT[] DEFAULT ARRAY['read']::TEXT[],
    rate_limit INTEGER DEFAULT NULL,

    -- Expiration tracking
    expires_at TIMESTAMPTZ DEFAULT NULL,

    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index on project_id
CREATE INDEX IF NOT EXISTS idx_api_keys_project_id ON control_plane.api_keys(project_id);

-- Create index on expires_at for key rotation queries
CREATE INDEX IF NOT EXISTS idx_api_keys_expires_at ON control_plane.api_keys(expires_at);

-- Add comment to table
COMMENT ON TABLE control_plane.api_keys IS 'API keys for project authentication and authorization';

-- Add comments to columns
COMMENT ON COLUMN control_plane.api_keys.id IS 'Unique identifier for the API key';
COMMENT ON COLUMN control_plane.api_keys.project_id IS 'Project ID this key belongs to';
COMMENT ON COLUMN control_plane.api_keys.key_type IS 'Type of key (api, webhook, etc.)';
COMMENT ON COLUMN control_plane.api_keys.key_prefix IS 'Key prefix for identification (e.g., nm, nm_prod)';
COMMENT ON COLUMN control_plane.api_keys.key_hash IS 'Hashed key value';
COMMENT ON COLUMN control_plane.api_keys.scopes IS 'Array of permission scopes';
COMMENT ON COLUMN control_plane.api_keys.rate_limit IS 'Rate limit per minute (null = unlimited)';
COMMENT ON COLUMN control_plane.api_keys.expires_at IS 'Key expiration time (null = no expiration)';
COMMENT ON COLUMN control_plane.api_keys.created_at IS 'Timestamp when key was created';
COMMENT ON COLUMN control_plane.api_keys.updated_at IS 'Timestamp when key was last updated';
