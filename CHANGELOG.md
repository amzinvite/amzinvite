# Changelog

## [0.1.41] — notification de sélection ciblée

### Changes
- Ouvre la fiche enrichie des statistiques PrixTCG depuis la notification de sélection et met automatiquement le bon produit en évidence.
- Affiche une carte de sélection depuis les données locales lorsque le produit n’est pas encore présent dans la vague publique.

## [0.1.40] — republication de la release

### Changes
- Incrémente la version destinée au Chrome Web Store après la soumission de la 0.1.39.
- Signale sur la page des statistiques PrixTCG les produits pour lesquels l’utilisateur a été sélectionné, avec le délai local restant et un accès direct à Amazon.

## [0.1.39] — alertes d'invitation explicites

### Fixes
- Remplace l'alerte ambiguë « Invitation dispo » par « Demande d'invitation ouverte » lorsqu'Amazon permet seulement de déposer une demande.
- Évite cette seconde alerte lorsque l'auto-demande vient de réussir ; seule la confirmation d'auto-demande est alors affichée.
- Confirme sur la fiche Amazon les redemandes après expiration avant d'annoncer leur succès, sans ajouter d'événement backend ni de charge D1.
- Affiche la miniature du produit dans les notifications natives, avec retour sur l'icône amzinvite si l'image Amazon n'est pas exploitable.
- Harmonise les badges en « Demande ouverte » et restaure la détection textuelle des sélections sur les anciennes variantes de buybox Amazon.
- Migre les anciennes alertes ambiguës déjà stockées, interrompt un cycle sur HTTP 503 et ajoute un coupe-circuit après trois erreurs consécutives.
- Ajoute une analyse statique `no-undef` obligatoire à la recette de release afin de bloquer les références JavaScript inexistantes.

## [0.1.38] — correction du contrôle Amazon

### Fixes
- Supprime deux appels orphelins à l'ancien historique local des prix qui faisaient échouer la détection dès qu'une fiche Amazon affichait un prix.
- Mémorise la dernière vague déjà finalisée au premier lancement sans afficher une alerte historique trompeuse.
- Rend l'arrêt immédiat dans le popup et nettoie les progressions orphelines même si le service worker a redémarré.
- Ajoute un test de non-régression sur un parcours complet avec prix affiché.

## [0.1.37] — suivi des scans complets

### Features
- Affiche la date, la couverture et la durée du dernier parcours complet réussi sur l'appareil.
- Transmet un résumé agrégé du cycle avec le lot de résultats existant afin de mesurer la couverture réelle sans ajouter de requête réseau sur un scan normal.

## [0.1.35] — contrôle des notifications

### Features
- Ajoute un réglage pour désactiver les notifications natives tout en conservant l’historique interne des alertes.
- Ajoute des accès directs aux comptes X et TikTok `@amzinvite` depuis les réglages.

## [0.1.34] — arrêt du scraping Amazon passif

### Privacy
- Supprime l’analyse silencieuse des pages de recherche et boutiques Amazon.
- Supprime la collecte passive des noms, prix, stocks et images pendant la navigation.
- Supprime la file locale, l’alarme et le credential dédiés aux observations.

### Maintenu
- Conserve la détection des invitations sur les fiches produit suivies, les contrôles programmés, l’auto-demande, les notifications et les statistiques de vague.

## [0.1.33] — lisibilité de l’historique

### Fixes
- Ajoute un espacement net entre l’icône de l’événement et le titre dans l’historique des alertes.
- Structure le titre, le message et l’horodatage en colonne pour éviter leur collage visuel.

## [0.1.32] — surveillance intelligente des vagues

### Features
- Conserve localement les 30 dernières alertes dans une boîte de réception avec statut lu/non lu et liens d’action.
- Ajoute une recherche locale instantanée par nom, ASIN ou marketplace dans la liste des produits suivis.
- Autorise l’ajout manuel de liens produits Amazon Belgique (`amazon.com.be`).
- Planifie le contrôle d’un nouveau produit du feed 2 à 10 minutes après sa découverte, sans rescanner toute la liste.
- Remplace l'intervalle manuel par des contrôles ponctuels et aléatoires après le début de chaque vague.
- Aligne le créneau du lundi sur 22 h (Europe/Paris) et conserve celui du vendredi à 10 h.
- Rapproche les contrôles pendant les trois premières heures afin de détecter rapidement un déclenchement Amazon décalé.
- Couvre la fenêtre de 24 h avec rattrapage au prochain démarrage de Chrome.
- Notifie une seule fois la publication des statistiques finalisées, y compris après un démarrage tardif.
- Groupe les feedbacks d'un cycle afin de réduire les appels au Worker.

### Changes
- Affiche les réglages dans un écran dédié à l’intérieur de l’extension, avec retour vers le suivi, sans panneau superposé.
- Ajoute les produits Amazon Belgique en statut « À vérifier » sans exiger que la page expose immédiatement le mode invitation.
- Corrige la demande de permission Amazon Belgique avec des origines HTTPS strictes compatibles avec Chrome.
- Précise dans le compteur s’il s’agit d’une synchronisation, d’un contrôle Amazon ou d’un rattrapage.
- Synchronise le feed sans requête Amazon avant les vagues.
- Mélange l'ordre des produits et élargit les pauses aléatoires entre requêtes.
- Interrompt un cycle en cas de captcha, HTTP 403 ou HTTP 429.
- Ajoute une construction minifiée `src/` vers `dist/` pour les archives Chrome Store.

## [0.1.31] — identifiant d’installation stable

### Fixes
- Sérialise la création de l’identifiant anonyme au premier lancement afin que
  des tâches concurrentes ne puissent plus enregistrer plusieurs UUID pour une
  seule installation Chrome.

### Tests
- Vérifie que vingt appels concurrents réutilisent tous le même identifiant.

## [0.1.30] — rythme des vagues d’invitations

### Features
- Affiche un compte à rebours jusqu’à la prochaine vague estimée à partir du
  rythme observé.
- Ajoute un accès direct aux statistiques publiques de la dernière vague sur
  PrixTCG.

### Changes
- Présente l’estimation sans mention technique superflue dans le popup.

## [0.1.29] — télémétrie économe et résiliente

### Changes
- Déduplique localement pendant une heure les feedbacks identiques avant leur
  envoi au backend.
- Met les observations Amazon en file locale et les envoie par lots, avec un
  premier essai après une minute puis une reprise automatique toutes les cinq
  minutes.
- Conserve les observations dans la file tant que le backend ne confirme pas
  leur réception, afin de résister aux erreurs réseau et aux limitations.

### Tests
- Vérifie la mise en file, la déduplication, la signature du lot, le retrait
  après succès et l'absence de renvoi dans la même heure.

## [0.1.28] — attribution du trafic PrixTCG

### Fixes
- Ajoute les paramètres UTM aux liens PrixTCG afin d'attribuer les visites à
  Amzinvite dans Google Analytics, tout en conservant le paramètre `source`
  utilisé par le routage existant.

## [0.1.27] — fiabilité Amazon et PrixTCG

### Features
- Statut de connexion Amazon France fiabilisé
- Accès permanent au comparateur PrixTCG.fr depuis le popup et l'onboarding
- Partage anonyme des observations limité aux pages Amazon visitées par l'utilisateur

### Changes
- Intervalle automatique minimal porté à 30 minutes et normalisation des anciennes valeurs locales
- Documentation et onboarding enrichis pour expliquer le suivi automatique
- Authentification individuelle v2 utilisée sans ancien secret partagé de secours

### Fixes
- Détection FR corrigée lorsque la page compte authentifiée contient aussi le lien « Utiliser un compte différent »
- Bandeau de connexion contenu dans les marges du popup, sans débordement
- Auto-demande après expiration rétablie uniquement lorsque la redemande est réellement possible
- Cooldown appliqué seulement après une réponse Amazon réussie ; les erreurs restent visibles dans le résumé

### Tests
- Ajoute une matrice de détection Amazon, des tests d'intégration AUTO et un contrôle automatisé de l'archive Store

## [0.1.26] — présence PrixTCG et activation guidée

### Features
- Proposition discrète d’activer l’auto-demande après le premier check manuel, avec choix mémorisé localement
- Accès PrixTCG toujours visible sous la liste, même lorsque tous les produits ont été vérifiés ou masqués
- Logo officiel et lien PrixTCG permanent dans les réglages

## [0.1.25] — comparaison PrixTCG

### Features
- Lien explicite « Comparer sur PrixTCG » pour chaque produit suivi
- Résolution du produit par ASIN sur PrixTCG, sans lien affilié Amazon dans l'extension
- Provenance `amzinvite` conservée jusqu'aux clics marchands du comparateur

## [0.1.24] — fiabilité des observations Amazon

### Fixes
- Extraction du vrai titre produit sur le nouveau layout des listings Amazon,
  au lieu de la marque affichée dans le premier `h2`
- Remontée explicite de `stock_status` pour les observations issues des listings
- Conservation des centimes lorsque le prix Amazon est séparé entre parties
  entière et décimale

## [0.1.23] — authentification aléatoire par installation

### Security
- Enrôlement automatique d'un credential HMAC aléatoire propre à chaque installation
- Credential séparé et renouvelé toutes les 48 h pour les observations anonymes, sans `instanceId`
- Fallback temporaire sur l'ancien secret partagé pour assurer une migration sans coupure

## [0.1.22] — nouveautés du feed Amazon

### Features
- Badge `NEW` sur les produits du feed ajoutés dans les 15 derniers jours
- Notification navigateur quand un refresh du feed détecte un nouveau lien Amazon

### Changes
- Tri de la popup ajusté : les produits sélectionnés restent tout en haut, puis les nouveautés, puis le reste du suivi

## [0.1.21] — fix fausse notif sur invitation expirée

### Fixes
- Une invitation expirée (`hdp_expired_desktop`, fenêtre d'achat de 72h dépassée) était classée comme `available`, ce qui déclenchait une fausse notif « 🎟️ Invitation dispo » au re-scan. Elle est désormais classée `already_requested` (état réellement affiché par Amazon : plus achetable), donc plus aucune notif à tort (`content.js`, `detector.js`)

## [0.1.20] — onboarding : précision « Chrome ouvert »

### Changes
- Onboarding plus honnête : l'auto-demande ne tourne que tant que Chrome reste ouvert (ordi allumé). Texte du hero et conditions requises ajustés (« garde Chrome ouvert + connecte-toi à Amazon »)

## [0.1.19] — barre d'actions sur une seule ligne

### Fixes
- Le bouton « Vérifier maintenant » se réduit pour que la bascule de vue et les réglages tiennent sur la même ligne (la grille passait le 3e bouton à la ligne)

## [0.1.18] — refonte de l'onboarding (axé auto-demande)

### Changes
- Onboarding repensé (visuel + texte), angle « drop hunter » : titre FOMO, flux en 3 étapes (on surveille → on demande → tu achètes), badge « 100% automatique » pulsé
- Panneau d'activation central avec bouton « ⚡ Activer l'auto-demande » qui active l'option en un clic (`onboarding.js`, page d'extension), avec rappel de l'unique action requise (connexion Amazon) et note CGU honnête mais discrète
- Étapes secondaires condensées (son/notif, scan, vue compacte, confidentialité)

## [0.1.17] — bascule de vue compacte (bouton unique)

### Changes
- La bascule de vue devient un bouton-switch unique placé entre « Vérifier maintenant » et ⚙ (gain de place) ; l'icône change selon le mode (lignes → compacter, cartes → agrandir) et le bouton se surligne en vue compacte

## [0.1.16] — sélecteur de mode d'affichage

### Changes
- Le choix vue confortable / vue liste compacte passe dans un sélecteur d'icônes directement au-dessus de la liste (plus besoin d'ouvrir les réglages)
- Retrait du toggle « Vue compacte » du menu réglages (remplacé par le sélecteur)

## [0.1.15] — vue compacte

### Features
- Toggle « Vue compacte » dans les réglages : liste plus dense (miniatures, marges et polices réduites) pour voir plus de produits d'un coup. Préférence mémorisée localement

### Changes
- Correction du libellé du réglage POKÉMON TCG FR (indiquait encore « désactivé par défaut »)

## [0.1.14] — feed public protégé (requête signée)

### Changes
- Les requêtes vers le feed public sont désormais signées HMAC (`X-Instance-Id`/`X-Ts`/`X-Sig` sur le path), même schéma que le feedback. Empêche le scraping anonyme trivial de la liste curée (le secret reste extractible côté navigateur, c'est une protection contre la copie facile, pas absolue)

## [0.1.13] — effets visuels + Pokémon TCG FR par défaut

### Changes
- Suivi automatique POKÉMON TCG FR **activé par défaut** (feed pré-chargé au premier install). Le décocher vide la liste des produits du feed ; les liens ajoutés manuellement sont conservés
- Effets visuels sur la liste : produit « sélectionné » avec halo vert pulsé + reflet qui balaie + pastille animée, invitation « dispo » avec accent ambré qui respire (respecte `prefers-reduced-motion`)
- Docs (README, PRIVACY, onboarding) mises à jour pour refléter le suivi par défaut

### Tests
- Ajout d'une suite de tests Node (`test/background.test.mjs`) couvrant export/import, dédoublonnage par ASIN, application des réglages et défauts

## [0.1.12] — son d'alerte + export/import

### Features
- Son d'alerte joué quand une invitation devient disponible ou que tu es sélectionné (carillon distinct pour « sélectionné »), via un document offscreen WebAudio — activable/désactivable depuis les réglages (ON par défaut)
- Les notifications « sélectionné » restent affichées jusqu'à action de l'user (`requireInteraction`)
- Export de la watchlist custom + réglages dans un fichier JSON, et import/restauration depuis ce fichier (fusion dédoublonnée par ASIN, sans re-validation réseau)

## [0.1.10] — SEO fiche store

### Changes
- Titre et résumé du manifest optimisés pour la recherche Chrome Web Store (axe « invitations Amazon Pokémon TCG »)
- Incrément de version pour la soumission au store

## [0.1.9] — interface en thème clair (fond blanc)

### Changes
- Popup et page d'onboarding passées sur un fond blanc épuré (surfaces et bordures neutres, accents de marque conservés)
- Suppression de la variante `prefers-color-scheme: dark` : l'interface reste blanche en permanence, quel que soit le thème système
- Les miniatures produits (images Amazon transparentes) rendent mieux sur le fond blanc

## [0.1.8] — temps restant invitation affiché dans la popup

### Features
- Affichage du temps restant avant expiration de l'invitation quand l'état est "Sélectionné" (badge vert ⏱ dans la liste)
- Extraction depuis `#expiryTime` (DOM) lors de la visite de la page, et depuis le HTML brut lors des checks automatiques
- Le temps est actualisé à chaque scan (check auto ou scan solo)

## [0.1.7] — scan solo, ETA global, nettoyage popup

### Features
- Bouton de scan individuel par produit — relance un check unitaire sans lancer le cycle complet
- Compte à rebours de 3s sur le bouton de scan solo (garanti même si Amazon répond plus vite)
- ETA global dynamique sur la barre de progression : moyenne mobile exponentielle (EMA 70/30) affiché en décompte temps réel
- Compte à rebours pendant la phase d'attente inter-articles (délai jitter exact transmis depuis le background)

### Fixes
- Suppression des informations redondantes dans le header (lastRun, compteurs de liste)
- Correction du bug CSS.escape sur les URLs Amazon dans les sélecteurs de bouton
- Await rerenderCurrentList() avant de démarrer le CD solo pour garantir la présence du DOM

## [0.1.6] — UX popup : statut Amazon, images, progression

### Features
- Statut de connexion Amazon en temps réel (cookie `at-acbfr`) affiché en haut à droite
- Avertissement visible si l'utilisateur n'est pas connecté à son compte Amazon
- Miniatures produits (52×52) extraites du HTML Amazon lors des checks, avec fond blanc et zoom au survol
- Preview image flottante positionnée via JS (hors overflow de la liste) avec fond blanc
- Placeholder 52px réservé avant le chargement de l'image pour éviter les layout shifts
- Tooltip sur les noms tronqués, icône externe sur les liens ASIN
- L'item en cours de scan remonte automatiquement en tête de liste avec highlight bleu
- Permission `cookies` ajoutée au manifest

### Fixes
- Suppression du texte "Auto-demande disponible dans les réglages" (redondant)

## [0.1.5] — images produits, date import Pokémon, check rapide

### Features
- Miniatures produits extraites du HTML Amazon (data-old-hires, data-a-dynamic-image) et stockées dans `knownImages`
- Date du dernier import du feed Pokémon TCG FR affichée sous le toggle dans les réglages
- Délai inter-articles réduit de 20s à 8s (jitter 6–10s)

## [0.1.4] — expired invitations

### Fixes
- Traite les invitations expirees comme `available` afin de permettre une nouvelle demande

## [0.1.3] — recheck pending invitations

### Fixes
- Recheck automatiquement les produits `already_requested` toutes les 4h afin de detecter leur passage en `accepted`
- Permet au bouton "Check maintenant" de bypasser cette fenetre pour debug

## [0.1.2] — worker hotfix

### Fixes
- Stabilise les notifications cliquables avec des identifiants courts
- Restaure la detection conservative des etats Amazon pour eviter les faux `accepted`

## [0.1.1] — invitation state regression fix

### Fixes
- Corrige une regression de detection qui pouvait classer trop de produits en `already_requested`
- Priorise les signaux Amazon visibles et actionnables pour distinguer `available`, `accepted` et `already_requested`
- Aligne la logique de detection entre le background check et la visite manuelle d'une fiche produit

## [0.1.0] — initial release

### Features
- Suivi des produits Amazon en mode invitation
- Feed communautaire (public, anonyme, cacheable)
- Détection des 5 états Amazon : available / already_requested / accepted / expired / consumed
- Notifications Chrome natives
- Auto-demander d'invitation via POST direct (opt-in, OFF par défaut)
- Ajout manuel d'URLs produit
- Opt-in pour partage anonyme de détections (UUID)
- Opt-in pour partage anonyme d'observations Amazon (catalogue)
- Reset complet à tout moment
- Dark mode automatique
