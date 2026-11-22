# EVACTIS 3DWORKFLOW Studio — user guide / guide d’utilisation

*For Evactis staff who build facility environments. / Pour le personnel d’Evactis qui
produit les environnements.*

[English](#english) · [Français](#français)

## English

Studio turns a site's captures into a finished environment and delivers it. Everything
stays on your computer: projects are folders you own, media is never uploaded, and
Studio makes no network requests.

### The workflow

1. **New project** (or open an existing `.evxproj`). A project is a folder holding the
   `.evxproj` file and `media/`; keep it on encrypted storage, as it contains facility
   photos.
2. **Media**: import panoramas (equirectangular, up to 12K and beyond), 360° videos,
   floor plans (PNG/JPG/TIFF), photos, sounds, PDFs, GLB models and splats, by **Import media…**
   or drag and drop. Studio tiles and checks each file; progress and errors show in the
   library. (Insta360 originals are not yet supported: export stitched images first.)
3. **Tour**: add scenes from the library, set each scene's start view and north, and add
   **link** and **information** hotspots by clicking the preview, or with the keyboard:
   turn the view with the arrow keys, then **Place at the centre of the view**. Drag a
   hotspot to move it (or **Move to the centre of the view**). Link suggestions (from
   plan positions, GPS or capture order) are offered; you accept each one. Links are
   **floor arrows**: place them on the floor where the next scene is (in front of the
   door), and they light up one chevron after another towards it; following one is a
   walk-through (the view turns to the arrow and moves on into the next scene). Each
   link's **Appearance** can be an arrow button instead; **Use floor arrows for all
   links** (scene panel, **Link style**) converts links made before.
4. **Floors**: add buildings and floors, import each plan, **Set scale** with two points
   and a known distance, set plan north, and **Place scene** on the plan (click, or Tab to
   the plan and use the arrow keys and Enter).
5. **Safety**: add equipment from the list, place it in the scene and on the plan, draw
   routes (primary and alternative) to the assembly point, define postings, and
   **confirm** each item by name. Only confirmed items appear on printed plans and
   routes; moving an item clears its confirmation. Choose which audiences see which
   layers. Print evacuation plans (letter/tabloid, bilingual, "You are here", verify-on-
   site note and date) and the equipment register.
6. **Content**: live layers (smoke conditions), animated regions, sounds, albums,
   documents and timed hotspots in 360° videos.
7. **Training**: modules made of steps (navigate, find an item, reach the nearest exit,
   hazard hunt, questions), points, hints, checklist and audiences; **Test the module**
   and export SCORM.
8. **Skin**: the Evactis default, or a client's colours and logo, checked for contrast,
   at phone, tablet, desktop and kiosk sizes.
9. **Package…** (top bar): choose the delivery form (installer, `.evx`, portable,
   intranet, browser folder, single file, SCORM), an optional passphrase (typed twice;
   it cannot be recovered), kiosk mode and the folder. The dialog warns about unconfirmed
   safety items and large single files.

**Undo/redo**: Ctrl+Z / Ctrl+Y. Studio saves automatically; **Versions** keeps snapshots
(on open and every 10 minutes) you can restore.

**Fitting the window**: Studio opens maximized. The full-screen button at the top right
(or F11) fills the whole screen; press it again, or F11, to return. With a project open,
one slim bar holds the project, Undo/Redo, **Package…**, the language, light/dark and
interface-size controls and **Close project**, above the section tabs. Each tab fits
the window, and only a long list or inspector scrolls inside its own panel. Drag the
divider beside a side panel (or focus it and use the arrow keys; double-click resets) to
make it wider or narrower. **A− / A+** in the top bar (or Ctrl − / Ctrl + / Ctrl 0)
make the whole interface smaller or larger. Studio remembers both on this computer.

### Before delivering

- Every safety item confirmed by a named person, plans printed and checked on site.
- Package tested on a clean PC (see the IT deployment guide), passphrase sent through a
  different channel than the package.
- Per-facility setups signed at the offline signing station
  ([release-procedure.md](release-procedure.md#5-client-deliveries-per-facility)).

## Français

Studio transforme les captures d’un site en environnement fini et le livre. Tout reste
sur votre ordinateur : les projets sont des dossiers qui vous appartiennent, les médias
ne sont jamais téléversés et Studio ne fait aucune requête réseau.

### La démarche

1. **Nouveau projet** (ou ouvrez un `.evxproj` existant). Un projet est un dossier qui
   contient le fichier `.evxproj` et `media/`; gardez-le sur un support chiffré, car il
   contient des photos de l’établissement.
2. **Médias** : importez panoramas (équirectangulaires, 12K et plus), vidéos 360°, plans
   (PNG/JPG/TIFF), photos, sons, PDF, modèles GLB et splats, par **Importer des médias…** ou par
   glisser-déposer. Studio découpe et vérifie chaque fichier; la progression et les
   erreurs s’affichent dans la bibliothèque. (Les originaux Insta360 ne sont pas encore
   pris en charge : exportez d’abord des images assemblées.)
3. **Visite** : ajoutez des scènes depuis la bibliothèque, réglez la vue de départ et le
   nord de chaque scène, et ajoutez des points d’intérêt **lien** et **information** en
   cliquant dans l’aperçu, ou au clavier : tournez la vue avec les flèches, puis
   **Placer au centre de la vue**. Faites glisser un point pour le déplacer (ou
   **Déplacer au centre de la vue**). Des liens sont suggérés (positions sur le plan, GPS
   ou ordre de capture); vous acceptez chacun. Les liens sont des **flèches au sol** :
   placez-les sur le sol, là où se trouve la scène suivante (devant la porte); elles
   s’allument l’une après l’autre dans sa direction, et les suivre est une marche (la vue
   se tourne vers la flèche puis avance dans la scène suivante). L’**Apparence** de chaque
   lien peut aussi être un bouton flèche; **Flèches au sol pour les liens** (panneau de
   la scène, **Style des liens**) convertit les liens créés avant.
4. **Étages** : ajoutez bâtiments et étages, importez chaque plan, **Définir l’échelle** avec
   deux points et une distance connue, réglez le nord du plan et **Placer une scène** sur le
   plan (clic, ou Tab jusqu’au plan puis flèches et Entrée).
5. **Sécurité** : ajoutez l’équipement depuis la liste, placez-le dans la scène et sur le
   plan, tracez les itinéraires (principal et de rechange) jusqu’au point de
   rassemblement, définissez les affichages et **confirmez** chaque élément en votre nom.
   Seuls les éléments confirmés apparaissent sur les plans imprimés et les itinéraires;
   déplacer un élément annule sa confirmation. Choisissez quels publics voient quelles
   couches. Imprimez les plans d’évacuation (lettre/tabloïd, bilingues, « Vous êtes ici »,
   mention de vérification sur place et date) et le registre d’équipement.
6. **Contenu** : couches en direct (conditions de fumée), zones animées, sons, albums,
   documents et points temporisés dans les vidéos 360°.
7. **Formation** : modules faits d’étapes (se déplacer, trouver un objet, atteindre la
   sortie la plus proche, chasse aux dangers, questions), points, indices, liste de
   vérification et publics; **Essayer le module** et exporter en SCORM.
8. **Habillage** : celui d’Evactis par défaut, ou les couleurs et le logo d’un client,
   vérifiés pour le contraste, aux tailles téléphone, tablette, bureau et borne.
9. **Empaqueter…** (barre du haut) : choisissez la forme de livraison (programme
   d’installation, `.evx`, portable, intranet, dossier navigateur, fichier unique, SCORM),
   une phrase de passe facultative (tapée deux fois; elle ne peut pas être récupérée), le
   mode borne et le dossier. La fenêtre signale les éléments de sécurité non confirmés et
   les fichiers uniques volumineux.

**Annuler/rétablir** : Ctrl+Z / Ctrl+Y. Studio enregistre automatiquement; **Versions**
conserve des instantanés (à l’ouverture et toutes les 10 minutes) que vous pouvez
restaurer.

**Adapter à la fenêtre** : Studio s’ouvre agrandi. Le bouton plein écran en haut à
droite (ou F11) occupe tout l’écran; appuyez de nouveau, ou sur F11, pour revenir. Avec
un projet ouvert, une seule barre mince réunit le projet, Annuler/Rétablir,
**Empaqueter…**, la langue, le clair/sombre, la taille de l’interface et **Fermer le
projet**, au-dessus des onglets. Chaque onglet tient dans la fenêtre; seule une longue liste ou un inspecteur défile dans son
propre panneau. Faites glisser le séparateur à côté d’un panneau latéral (ou placez-y le
focus et utilisez les flèches; un double-clic rétablit) pour l’élargir ou le rétrécir.
**A− / A+** dans la barre du haut (ou Ctrl − / Ctrl + / Ctrl 0) réduisent ou agrandissent
toute l’interface. Studio retient les deux sur cet ordinateur.

### Avant de livrer

- Chaque élément de sécurité confirmé par une personne nommée, plans imprimés et vérifiés
  sur place.
- Paquet testé sur un poste propre (voir le guide de déploiement TI), phrase de passe
  transmise par un autre canal que le paquet.
- Programmes d’installation par établissement signés au poste de signature hors ligne
  ([release-procedure.md](release-procedure.md#5-client-deliveries-per-facility)).
