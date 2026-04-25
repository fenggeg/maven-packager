use crate::error::{to_user_error, AppResult};
use crate::models::build::BuildArtifact;
use crate::services::{app_logger, blocking};
use chrono::{DateTime, Utc};
use std::fs;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::AppHandle;

const CREATE_NO_WINDOW: u32 = 0x08000000;

#[tauri::command]
pub fn open_path_in_explorer(app: AppHandle, path: String) -> AppResult<()> {
    app_logger::log_info(&app, "filesystem.open.start", format!("path={}", path));
    let target = PathBuf::from(&path);
    if !target.exists() {
        app_logger::log_error(
            &app,
            "filesystem.open.failed",
            format!("path={}, error=路径不存在", path),
        );
        return Err(to_user_error(format!("路径不存在：{}", path)));
    }

    let mut command = Command::new("explorer");
    if target.is_file() {
        command.arg("/select,").arg(target);
    } else {
        command.arg(target);
    }
    let result = command
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|error| to_user_error(format!("无法打开资源管理器：{}", error)));

    match &result {
        Ok(_) => app_logger::log_info(&app, "filesystem.open.success", format!("path={}", path)),
        Err(error) => app_logger::log_error(
            &app,
            "filesystem.open.failed",
            format!("path={}, error={}", path, error),
        ),
    }
    result?;

    Ok(())
}

#[tauri::command]
pub async fn scan_build_artifacts(
    app: AppHandle,
    project_root: String,
    module_path: String,
) -> AppResult<Vec<BuildArtifact>> {
    app_logger::log_info(
        &app,
        "filesystem.artifacts.scan.start",
        format!("project_root={}, module_path={}", project_root, module_path),
    );

    let result =
        blocking::run(move || scan_build_artifacts_sync(&project_root, &module_path)).await;
    match &result {
        Ok(artifacts) => app_logger::log_info(
            &app,
            "filesystem.artifacts.scan.success",
            format!("count={}", artifacts.len()),
        ),
        Err(error) => app_logger::log_error(
            &app,
            "filesystem.artifacts.scan.failed",
            format!("error={}", error),
        ),
    }
    result
}

fn scan_build_artifacts_sync(
    project_root: &str,
    module_path: &str,
) -> AppResult<Vec<BuildArtifact>> {
    let root = PathBuf::from(project_root);
    if !root.exists() {
        return Err(to_user_error(format!("项目路径不存在：{}", project_root)));
    }

    let mut artifacts = Vec::new();
    let module_paths = module_path
        .split(',')
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>();

    if module_paths.is_empty() {
        scan_target_dirs(&root, &root, &mut artifacts)?;
    } else {
        for module in module_paths {
            let module_root = root.join(module);
            scan_target_dir(&root, &module_root.join("target"), module, &mut artifacts)?;
        }
    }

    artifacts.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| right.size_bytes.cmp(&left.size_bytes))
    });
    artifacts.truncate(20);
    Ok(artifacts)
}

fn scan_target_dirs(
    project_root: &Path,
    current: &Path,
    artifacts: &mut Vec<BuildArtifact>,
) -> AppResult<()> {
    let entries = match fs::read_dir(current) {
        Ok(entries) => entries,
        Err(_) => return Ok(()),
    };

    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取目录：{}", error))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        if path.file_name().and_then(|name| name.to_str()) == Some("target") {
            let module_path = path
                .parent()
                .and_then(|parent| parent.strip_prefix(project_root).ok())
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default();
            scan_target_dir(project_root, &path, &module_path, artifacts)?;
        } else if !is_ignored_dir(&path) {
            scan_target_dirs(project_root, &path, artifacts)?;
        }
    }

    Ok(())
}

fn scan_target_dir(
    project_root: &Path,
    target_dir: &Path,
    module_path: &str,
    artifacts: &mut Vec<BuildArtifact>,
) -> AppResult<()> {
    if !target_dir.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(target_dir).map_err(|error| {
        format!(
            "无法读取构建产物目录 {}：{}",
            target_dir.to_string_lossy(),
            error
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("无法读取构建产物：{}", error))?;
        let path = entry.path();
        if !path.is_file() || !is_package_file(&path) {
            continue;
        }

        let metadata = entry
            .metadata()
            .map_err(|error| format!("无法读取构建产物信息：{}", error))?;
        let modified_at = metadata
            .modified()
            .ok()
            .map(DateTime::<Utc>::from)
            .map(|time| time.to_rfc3339());
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_string();
        let normalized_module_path = if module_path.is_empty() {
            path.parent()
                .and_then(|parent| parent.parent())
                .and_then(|parent| parent.strip_prefix(project_root).ok())
                .map(|relative| relative.to_string_lossy().replace('\\', "/"))
                .unwrap_or_default()
        } else {
            module_path.replace('\\', "/")
        };

        artifacts.push(BuildArtifact {
            path: path.to_string_lossy().to_string(),
            file_name,
            extension,
            size_bytes: metadata.len(),
            modified_at,
            module_path: normalized_module_path,
        });
    }

    Ok(())
}

fn is_package_file(path: &Path) -> bool {
    matches!(
        path.extension().and_then(|value| value.to_str()),
        Some("jar") | Some("war")
    )
}

#[tauri::command]
pub fn delete_build_artifact(app: AppHandle, path: String) -> AppResult<()> {
    app_logger::log_info(
        &app,
        "filesystem.artifact.delete.start",
        format!("path={}", path),
    );
    let target = PathBuf::from(&path);
    if !target.exists() {
        app_logger::log_error(
            &app,
            "filesystem.artifact.delete.failed",
            format!("path={}, error=文件不存在", path),
        );
        return Err(to_user_error(format!("文件不存在：{}", path)));
    }
    if !target.is_file() {
        app_logger::log_error(
            &app,
            "filesystem.artifact.delete.failed",
            format!("path={}, error=路径不是文件", path),
        );
        return Err(to_user_error(format!("路径不是文件：{}", path)));
    }
    fs::remove_file(&target).map_err(|error| {
        app_logger::log_error(
            &app,
            "filesystem.artifact.delete.failed",
            format!("path={}, error={}", path, error),
        );
        to_user_error(format!("无法删除文件 {}：{}", path, error))
    })?;
    app_logger::log_info(
        &app,
        "filesystem.artifact.delete.success",
        format!("path={}", path),
    );
    Ok(())
}

fn is_ignored_dir(path: &Path) -> bool {
    matches!(
        path.file_name().and_then(|name| name.to_str()),
        Some(".git") | Some("node_modules") | Some("dist") | Some(".idea")
    )
}
