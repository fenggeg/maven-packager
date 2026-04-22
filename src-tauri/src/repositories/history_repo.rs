use crate::error::AppResult;
use crate::models::history::BuildHistoryRecord;
use crate::repositories::storage::open_database;
use rusqlite::params;
use tauri::AppHandle;

pub fn list(app: &AppHandle) -> AppResult<Vec<BuildHistoryRecord>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM build_history ORDER BY created_at DESC")
        .map_err(|error| format!("无法读取构建历史：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取构建历史：{}", error))?;

    let mut records = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取构建历史：{}", error))?;
        let record = serde_json::from_str(&payload)
            .map_err(|error| format!("构建历史数据格式异常：{}", error))?;
        records.push(record);
    }

    Ok(records)
}

pub fn save(app: &AppHandle, record: BuildHistoryRecord) -> AppResult<()> {
    let connection = open_database(app)?;
    let payload = serde_json::to_string(&record)
        .map_err(|error| format!("无法序列化构建历史：{}", error))?;

    connection
        .execute(
            r#"
            INSERT INTO build_history (id, created_at, payload)
            VALUES (?1, ?2, ?3)
            ON CONFLICT(id) DO UPDATE SET
                created_at = excluded.created_at,
                payload = excluded.payload
            "#,
            params![record.id, record.created_at, payload],
        )
        .map_err(|error| format!("无法保存构建历史：{}", error))?;

    connection
        .execute(
            r#"
            DELETE FROM build_history
            WHERE id NOT IN (
                SELECT id FROM build_history
                ORDER BY created_at DESC
                LIMIT 100
            )
            "#,
            [],
        )
        .map_err(|error| format!("无法清理构建历史：{}", error))?;

    Ok(())
}
