# Changelog

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
