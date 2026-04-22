use crate::error::AppResult;
use crate::models::template::BuildTemplate;
use crate::repositories::storage::open_database;
use chrono::Utc;
use rusqlite::{params, OptionalExtension};
use tauri::AppHandle;

pub fn list(app: &AppHandle) -> AppResult<Vec<BuildTemplate>> {
    let connection = open_database(app)?;
    let mut statement = connection
        .prepare("SELECT payload FROM build_templates ORDER BY name ASC")
        .map_err(|error| format!("无法读取常用模板：{}", error))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("无法读取常用模板：{}", error))?;

    let mut templates = Vec::new();
    for row in rows {
        let payload = row.map_err(|error| format!("无法读取常用模板：{}", error))?;
        let template = serde_json::from_str(&payload)
            .map_err(|error| format!("常用模板数据格式异常：{}", error))?;
        templates.push(template);
    }

    Ok(templates)
}

pub fn save(app: &AppHandle, mut template: BuildTemplate) -> AppResult<()> {
    let now = Utc::now().to_rfc3339();
    let connection = open_database(app)?;
    let existing: Option<String> = connection
        .query_row(
            "SELECT created_at FROM build_templates WHERE id = ?1",
            params![template.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("无法读取常用模板：{}", error))?;

    template.created_at = existing.or_else(|| Some(now.clone()));
    template.updated_at = Some(now);

    let payload = serde_json::to_string(&template)
        .map_err(|error| format!("无法序列化常用模板：{}", error))?;
    connection
        .execute(
            r#"
            INSERT INTO build_templates (id, name, created_at, updated_at, payload)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                created_at = excluded.created_at,
                updated_at = excluded.updated_at,
                payload = excluded.payload
            "#,
            params![
                template.id,
                template.name,
                template.created_at,
                template.updated_at,
                payload
            ],
        )
        .map_err(|error| format!("无法保存常用模板：{}", error))?;

    Ok(())
}

pub fn delete(app: &AppHandle, template_id: &str) -> AppResult<()> {
    let connection = open_database(app)?;
    connection
        .execute(
            "DELETE FROM build_templates WHERE id = ?1",
            params![template_id],
        )
        .map_err(|error| format!("无法删除常用模板：{}", error))?;

    Ok(())
}
