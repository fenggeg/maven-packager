use crate::error::AppResult;
use crate::models::environment::EnvironmentSettings;
use crate::repositories::storage::open_database;
use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

pub fn load(app: &AppHandle) -> AppResult<EnvironmentSettings> {
    let connection = open_database(app)?;
    let payload: Option<String> = connection
        .query_row("SELECT payload FROM app_settings WHERE id = 1", [], |row| {
            row.get(0)
        })
        .optional()
        .map_err(|error| format!("无法读取本地设置：{}", error))?;

    match payload {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| format!("本地设置数据格式异常：{}", error)),
        None => Ok(EnvironmentSettings::default()),
    }
}

pub fn save(app: &AppHandle, settings: EnvironmentSettings) -> AppResult<()> {
    let connection = open_database(app)?;
    let payload = serde_json::to_string(&settings)
        .map_err(|error| format!("无法序列化本地设置：{}", error))?;

    connection
        .execute(
            r#"
            INSERT INTO app_settings (id, payload)
            VALUES (1, ?1)
            ON CONFLICT(id) DO UPDATE SET payload = excluded.payload
            "#,
            params![payload],
        )
        .map_err(|error| format!("无法保存本地设置：{}", error))?;

    Ok(())
}
