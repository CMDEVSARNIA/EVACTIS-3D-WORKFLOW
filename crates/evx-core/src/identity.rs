//! Product naming. These strings appear wherever Windows shows a program name.

pub const PUBLISHER: &str = "Evactis";
pub const PRODUCT: &str = "EVACTIS 3DWORKFLOW";
pub const STUDIO_NAME: &str = "EVACTIS 3DWORKFLOW Studio";
pub const VIEWER_NAME: &str = "EVACTIS 3DWORKFLOW Viewer";
/// Bundle identifiers. Never change after the first release (Windows upgrades key on them).
pub const STUDIO_ID: &str = "ca.evactis.3dworkflow.studio";
pub const VIEWER_ID: &str = "ca.evactis.3dworkflow.viewer";
/// Studio project files and packaged environments.
pub const PROJECT_EXT: &str = "evxproj";
pub const ENVIRONMENT_EXT: &str = "evx";
/// Folder under the user's Documents that holds projects. Never deleted by uninstall.
pub const DOCUMENTS_FOLDER: &str = "EVACTIS 3DWORKFLOW";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_follow_the_product_naming_rules() {
        for name in [PRODUCT, STUDIO_NAME, VIEWER_NAME] {
            assert!(name.starts_with("EVACTIS 3DWORKFLOW"));
            assert!(!name.contains("3D WORKFLOW"));
        }
        assert!(STUDIO_ID.starts_with("ca.evactis.3dworkflow."));
        assert!(VIEWER_ID.starts_with("ca.evactis.3dworkflow."));
    }
}
