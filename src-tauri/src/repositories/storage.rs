use crate::error::{to_user_error, AppResult};
use rusqlite::Connection;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const DATABASE_FILE: &str = "app.sqlite3";

pub fn open_database(app: &AppHandle) -> AppResult<Connection> {
    let path = database_path(app)?;
    let connection = Connection::open(path)
        .map_err(|error| to_user_error(format!("无法打开本地数据库：{}", error)))?;
    initialize_database(&connection)?;
    Ok(connection)
}

fn initialize_database(connection: &Connection) -> AppResult<()> {
    connection
        .execute_batch(
            r#"
            PRAGMA foreign_keys = ON;

            CREATE TABLE IF NOT EXISTS build_history (
                id TEXT PRIMARY KEY NOT NULL,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_build_history_created_at
                ON build_history(created_at DESC);

            CREATE TABLE IF NOT EXISTS build_templates (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_build_templates_name
                ON build_templates(name ASC);

            CREATE TABLE IF NOT EXISTS app_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                payload TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS server_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_server_profiles_name
                ON server_profiles(name ASC);

            CREATE TABLE IF NOT EXISTS deployment_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                created_at TEXT,
                updated_at TEXT,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_deployment_profiles_name
                ON deployment_profiles(name ASC);

            CREATE TABLE IF NOT EXISTS deployment_tasks (
                id TEXT PRIMARY KEY NOT NULL,
                deployment_profile_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                payload TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_deployment_tasks_created_at
                ON deployment_tasks(created_at DESC);
            "#,
        )
        .map_err(|error| to_user_error(format!("无法初始化本地数据库：{}", error)))
}

fn database_path(app: &AppHandle) -> AppResult<PathBuf> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| to_user_error(format!("无法获取应用数据目录：{}", error)))?;
    fs::create_dir_all(&dir)
        .map_err(|error| to_user_error(format!("无法创建应用数据目录：{}", error)))?;
    Ok(dir.join(DATABASE_FILE))
}
