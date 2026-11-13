; EVACTIS 3DWORKFLOW combined setup (ADR 0022).
;
; One setup for people installing by hand: choose the Viewer, Studio or both, and who can
; use them. It carries Microsoft's offline WebView2 installer once (run only if the
; runtime is missing) and the two product setups, built without their own WebView2 copy,
; and runs those setups silently. Each program keeps its own uninstaller, upgrade
; identity and Apps entry; this setup registers nothing of its own and needs no network.
;
; Built by scripts/windows/build-installers.ps1:
;   makensis /DVERSION=1.0.0 /DVIEWER_SETUP=<file> /DSTUDIO_SETUP=<file>
;            /DWEBVIEW2=<file> /DOUTFILE=<file> packaging\windows\suite\suite.nsi
;
; Silent: <setup> /S [/CurrentUser | /AllUsers] [/Viewer] [/Studio]
;   No /Viewer or /Studio installs the Viewer only. /AllUsers needs administrator rights.

Unicode true
ManifestDPIAware true
RequestExecutionLevel highest
; The setups and the WebView2 installer inside are compressed already: store them as is.
SetCompressor zlib

!ifndef VERSION | VIEWER_SETUP | STUDIO_SETUP | WEBVIEW2 | OUTFILE
  !error "Pass VERSION, VIEWER_SETUP, STUDIO_SETUP, WEBVIEW2 and OUTFILE with /D"
!endif
; makensis compiles from the script's own folder. Forward slashes work on Windows and on
; a Linux build machine alike.
!define ROOT "../../.."
!define ART "${ROOT}/apps/viewer-desktop/src-tauri"
!define WEBVIEW2APPGUID "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

!include MUI2.nsh
!include nsDialogs.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include x64.nsh

Name "EVACTIS 3DWORKFLOW"
Caption "EVACTIS 3DWORKFLOW ${VERSION}"
BrandingText "Evactis"
OutFile "${OUTFILE}"

VIProductVersion "${VERSION}.0"
VIFileVersion "${VERSION}.0"

!define MUI_ICON "${ART}/icons/icon.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_BITMAP "${ART}/windows/nsis-header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "${ART}/windows/nsis-sidebar.bmp"
!define MUI_ABORTWARNING
!define MUI_COMPONENTSPAGE_SMALLDESC
!define MUI_LANGDLL_ALLLANGUAGES

Var Mode ; /CurrentUser or /AllUsers, passed to the product setups
Var IsAdmin
Var RadioMe
Var RadioAll

!define MUI_WELCOMEPAGE_TITLE "$(welcomeTitle)"
!define MUI_WELCOMEPAGE_TEXT "$(welcomeText)"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_LICENSE "${ROOT}/packaging/windows/LICENSE-EULA.txt"
!define MUI_PAGE_CUSTOMFUNCTION_LEAVE ComponentsLeave
!insertmacro MUI_PAGE_COMPONENTS
Page custom ModePage ModeLeave
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TITLE "$(finishTitle)"
!define MUI_FINISHPAGE_TEXT "$(finishText)"
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_LANGUAGE "English"
!insertmacro MUI_LANGUAGE "French"
!insertmacro MUI_RESERVEFILE_LANGDLL

VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductName" "EVACTIS 3DWORKFLOW"
VIAddVersionKey /LANG=${LANG_ENGLISH} "CompanyName" "Evactis"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileDescription" "EVACTIS 3DWORKFLOW Setup"
VIAddVersionKey /LANG=${LANG_ENGLISH} "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=${LANG_ENGLISH} "LegalCopyright" "© Evactis"

; ------------------------------------------------------------------ text (EN / FR)
LangString welcomeTitle ${LANG_ENGLISH} "Install EVACTIS 3DWORKFLOW ${VERSION}"
LangString welcomeTitle ${LANG_FRENCH} "Installer EVACTIS 3DWORKFLOW ${VERSION}"
LangString welcomeText ${LANG_ENGLISH} "This setup installs 3DWORKFLOW Viewer, 3DWORKFLOW Studio or both on this computer.$\r$\n$\r$\nNo internet connection is needed, and nothing is ever sent anywhere.$\r$\n$\r$\nSelect Next to continue."
LangString welcomeText ${LANG_FRENCH} "Ce programme installe 3DWORKFLOW Viewer, 3DWORKFLOW Studio ou les deux sur cet ordinateur.$\r$\n$\r$\nAucune connexion Internet n’est nécessaire, et rien n’est jamais transmis.$\r$\n$\r$\nSélectionnez Suivant pour continuer."
LangString viewerName ${LANG_ENGLISH} "3DWORKFLOW Viewer"
LangString viewerName ${LANG_FRENCH} "3DWORKFLOW Viewer"
LangString studioName ${LANG_ENGLISH} "3DWORKFLOW Studio"
LangString studioName ${LANG_FRENCH} "3DWORKFLOW Studio"
LangString viewerDesc ${LANG_ENGLISH} "Explore a facility: for staff, contractors, leadership and first responders."
LangString viewerDesc ${LANG_FRENCH} "Explorer un établissement : pour le personnel, les entrepreneurs, la direction et les premiers intervenants."
LangString studioDesc ${LANG_ENGLISH} "Build facility environments: for Evactis staff."
LangString studioDesc ${LANG_FRENCH} "Construire les environnements des établissements : pour le personnel d’Evactis."
LangString chooseOne ${LANG_ENGLISH} "Choose at least one program to install."
LangString chooseOne ${LANG_FRENCH} "Choisissez au moins un programme à installer."
LangString modeTitle ${LANG_ENGLISH} "Who can use it"
LangString modeTitle ${LANG_FRENCH} "Qui pourra l’utiliser"
LangString modeSubtitle ${LANG_ENGLISH} "Choose who can use the programs on this computer."
LangString modeSubtitle ${LANG_FRENCH} "Choisissez qui pourra utiliser les programmes sur cet ordinateur."
LangString modeMe ${LANG_ENGLISH} "Just me (no administrator rights needed)"
LangString modeMe ${LANG_FRENCH} "Moi seulement (aucun droit d’administrateur requis)"
LangString modeAll ${LANG_ENGLISH} "Everyone who uses this computer"
LangString modeAll ${LANG_FRENCH} "Toutes les personnes qui utilisent cet ordinateur"
LangString modeAllNeedsAdmin ${LANG_ENGLISH} "Needs administrator rights. Ask your IT team, or start this setup as an administrator."
LangString modeAllNeedsAdmin ${LANG_FRENCH} "Exige des droits d’administrateur. Demandez à votre équipe informatique, ou lancez ce programme en tant qu’administrateur."
LangString installingWebView2 ${LANG_ENGLISH} "Installing the Microsoft Edge WebView2 Runtime…"
LangString installingWebView2 ${LANG_FRENCH} "Installation du Microsoft Edge WebView2 Runtime…"
LangString installing ${LANG_ENGLISH} "Installing"
LangString installing ${LANG_FRENCH} "Installation de"
LangString failed ${LANG_ENGLISH} "could not be installed (error"
LangString failed ${LANG_FRENCH} "n’a pas pu être installé (erreur"
LangString finishTitle ${LANG_ENGLISH} "EVACTIS 3DWORKFLOW is installed"
LangString finishTitle ${LANG_FRENCH} "EVACTIS 3DWORKFLOW est installé"
LangString finishText ${LANG_ENGLISH} "Start it from Start › EVACTIS 3DWORKFLOW.$\r$\n$\r$\nEach program appears separately in Settings › Apps, where you can uninstall it later."
LangString finishText ${LANG_FRENCH} "Lancez-le depuis Démarrer › EVACTIS 3DWORKFLOW.$\r$\n$\r$\nChaque programme figure séparément dans Paramètres › Applications, où vous pourrez le désinstaller."

; ------------------------------------------------------------------ install
!macro Fail WHAT CODE
  DetailPrint "${WHAT} $(failed) ${CODE})"
  IfSilent +2
  MessageBox MB_ICONSTOP "${WHAT} $(failed) ${CODE})."
  SetErrorLevel ${CODE}
  Abort
!macroend

Section "-WebView2"
  ; Same check as the product setups: the runtime registers its version here.
  ${If} ${RunningX64}
    ReadRegStr $4 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${Else}
    ReadRegStr $4 HKLM "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
    ReadRegStr $4 HKCU "SOFTWARE\Microsoft\EdgeUpdate\Clients\${WEBVIEW2APPGUID}" "pv"
  ${EndIf}
  ${If} $4 == ""
  ${OrIf} $4 == "0.0.0.0"
    DetailPrint "$(installingWebView2)"
    SetOutPath $PLUGINSDIR
    SetCompress off
    File "/oname=$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" "${WEBVIEW2}"
    SetCompress auto
    ExecWait '"$PLUGINSDIR\MicrosoftEdgeWebView2RuntimeInstallerX64.exe" /silent /install' $1
    ${If} $1 <> 0
      !insertmacro Fail "Microsoft Edge WebView2 Runtime" $1
    ${EndIf}
  ${EndIf}
SectionEnd

!macro Part NAME FILE
  DetailPrint "$(installing) EVACTIS 3DWORKFLOW ${NAME}…"
  SetOutPath $PLUGINSDIR
  SetCompress off
  File "/oname=$PLUGINSDIR\EVACTIS-3DWORKFLOW-${NAME}-setup.exe" "${FILE}"
  SetCompress auto
  ExecWait '"$PLUGINSDIR\EVACTIS-3DWORKFLOW-${NAME}-setup.exe" /S $Mode' $1
  ${If} $1 <> 0
    !insertmacro Fail "EVACTIS 3DWORKFLOW ${NAME}" $1
  ${EndIf}
!macroend

Section "$(viewerName)" SecViewer
  !insertmacro Part "Viewer" "${VIEWER_SETUP}"
SectionEnd

Section /o "$(studioName)" SecStudio
  !insertmacro Part "Studio" "${STUDIO_SETUP}"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecViewer} "$(viewerDesc)"
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStudio} "$(studioDesc)"
!insertmacro MUI_FUNCTION_DESCRIPTION_END

; ------------------------------------------------------------------ choices
Function .onInit
  StrCpy $IsAdmin 0
  UserInfo::GetAccountType
  Pop $0
  ${If} $0 == "Admin"
    StrCpy $IsAdmin 1
  ${EndIf}

  ${GetParameters} $R0
  StrCpy $Mode "/CurrentUser"
  ClearErrors
  ${GetOptions} $R0 "/AllUsers" $R1
  ${IfNot} ${Errors}
    StrCpy $Mode "/AllUsers"
  ${EndIf}
  ; /Viewer and /Studio choose exactly those programs; with neither, the Viewer.
  ClearErrors
  ${GetOptions} $R0 "/Viewer" $R1
  ${IfNot} ${Errors}
    StrCpy $2 1
  ${Else}
    StrCpy $2 0
  ${EndIf}
  ClearErrors
  ${GetOptions} $R0 "/Studio" $R1
  ${IfNot} ${Errors}
    StrCpy $3 1
  ${Else}
    StrCpy $3 0
  ${EndIf}
  ${If} $2 = 1
  ${OrIf} $3 = 1
    ${If} $2 = 0
      SectionSetFlags ${SecViewer} 0
    ${EndIf}
    ${If} $3 = 1
      SectionSetFlags ${SecStudio} ${SF_SELECTED}
    ${EndIf}
  ${EndIf}

  ${If} ${Silent}
    ${If} $Mode == "/AllUsers"
    ${AndIf} $IsAdmin = 0
      SetErrorLevel 740 ; ERROR_ELEVATION_REQUIRED
      Quit
    ${EndIf}
  ${Else}
    !insertmacro MUI_LANGDLL_DISPLAY
  ${EndIf}
FunctionEnd

Function ComponentsLeave
  SectionGetFlags ${SecViewer} $0
  SectionGetFlags ${SecStudio} $1
  IntOp $0 $0 & ${SF_SELECTED}
  IntOp $1 $1 & ${SF_SELECTED}
  ${If} $0 = 0
  ${AndIf} $1 = 0
    MessageBox MB_ICONEXCLAMATION "$(chooseOne)"
    Abort
  ${EndIf}
FunctionEnd

Function ModePage
  !insertmacro MUI_HEADER_TEXT "$(modeTitle)" "$(modeSubtitle)"
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateRadioButton} 0 12u 100% 14u "$(modeMe)"
  Pop $RadioMe
  ${NSD_CreateRadioButton} 0 40u 100% 14u "$(modeAll)"
  Pop $RadioAll
  ${If} $IsAdmin = 0
    EnableWindow $RadioAll 0
    ${NSD_CreateLabel} 12u 56u 95% 24u "$(modeAllNeedsAdmin)"
    Pop $0
    StrCpy $Mode "/CurrentUser"
  ${EndIf}
  ${If} $Mode == "/AllUsers"
    ${NSD_Check} $RadioAll
  ${Else}
    ${NSD_Check} $RadioMe
  ${EndIf}
  nsDialogs::Show
FunctionEnd

Function ModeLeave
  ${NSD_GetState} $RadioAll $0
  ${If} $0 = ${BST_CHECKED}
    StrCpy $Mode "/AllUsers"
  ${Else}
    StrCpy $Mode "/CurrentUser"
  ${EndIf}
FunctionEnd
