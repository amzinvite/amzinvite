# Changelog

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
