# amzinvite

Extension Chrome qui surveille les produits Amazon en mode invitation et te prévient quand un produit s'ouvre ou quand tu es sélectionné.

[Installer amzinvite depuis le Chrome Web Store](https://chromewebstore.google.com/detail/amzinvite-%E2%80%94-invitations-a/omnadclklfdghknlhgfilpinklhgophe)

## Ce que fait l'extension

- suit automatiquement les produits POKÉMON TCG FR par défaut (désactivable d'un clic, ce qui retire alors tous les produits du feed)
- notifie (et joue un son) quand une invitation devient disponible ou acceptée
- permet d'ajouter un lien Amazon manuellement à ton suivi local
- propose une option d'auto-demande, désactivée par défaut
- permet de désactiver à tout moment le partage anonyme utilisé pour améliorer le service
- affiche les miniatures produits extraites depuis Amazon
- indique si tu es connecté à ton compte Amazon
- scan individuel par produit depuis le popup
- propose un lien volontaire vers la fiche PrixTCG correspondante pour comparer
  les prix, sans intégrer de lien affilié Amazon dans l'extension
- garde un accès discret à PrixTCG sous la liste et dans les réglages
- propose l’auto-demande une seule fois après le premier check manuel

## Installation

### Depuis le Chrome Web Store

[Installer la version officielle](https://chromewebstore.google.com/detail/amzinvite-%E2%80%94-invitations-a/omnadclklfdghknlhgfilpinklhgophe). Les mises à jour sont ensuite distribuées automatiquement par Chrome.

### En mode développeur

1. Clone le dépôt
2. Ouvre `chrome://extensions`
3. Active le mode développeur
4. Clique sur "Charger l'extension non empaquetée"
5. Sélectionne le dossier `src/`

## Réglages principaux

| Option | Défaut | Description |
|---|---|---|
| Intervalle auto | 30 min | Fréquence de vérification automatique |
| Son d'alerte | ON | Joue un son quand une invitation s'ouvre ou que tu es sélectionné |
| Partage anonyme | ON | Aide à améliorer le feed et le catalogue |
| Suivi POKÉMON TCG FR | ON | Suit automatiquement le feed public ; décocher retire tous les produits du feed |
| Auto-demander | OFF | Envoie la demande d'invitation automatiquement |

## Suivi et interface

- le suivi automatique POKÉMON TCG FR est actif par défaut ; le décocher vide la liste des produits du feed
- tu peux ajouter un produit manuellement via son lien Amazon en mode invitation (conservé même si tu désactives le feed)
- tu peux exporter ta watchlist + tes réglages dans un fichier JSON et les réimporter (sauvegarde / changement de machine)
- l'item en cours de vérification remonte en tête de liste avec une barre de progression, un compte à rebours et un ETA global
- un bouton de scan individuel permet de relancer un check unitaire sur n'importe quel produit
- les miniatures sont extraites automatiquement lors des checks et mises en cache localement
- « Comparer sur PrixTCG » ouvre une fiche PrixTCG avec la provenance
  `amzinvite`; les liens marchands restent ensuite gérés par le site PrixTCG

## PrixTCG et liens sortants

- amzinvite n'intègre pas de lien affilié Amazon
- les liens « Comparer sur PrixTCG » sont toujours déclenchés volontairement par l'utilisateur
- l'ASIN sert uniquement à retrouver la fiche correspondante sur PrixTCG
- la provenance `amzinvite` permet de mesurer l'utilité de l'extension sans transmettre l'identité de l'utilisateur
- une fois sur PrixTCG, les éventuels liens marchands et leur transparence sont gérés par PrixTCG

## Confidentialité

- aucun compte requis
- données locales conservées dans le navigateur
- partage anonyme désactivable à tout moment
- reset complet possible depuis le popup

Voir [PRIVACY.md](./PRIVACY.md).

## Structure

- `src/background.js` : logique principale (checks, watchlist, feed, notifications)
- `src/popup.html` et `src/popup.js` : interface du popup
- `src/prixtcg.js` : construction des liens explicites vers le comparateur
- `src/onboarding.html` : écran de bienvenue
- `src/content.js` : détection d'état sur les pages produit Amazon
- `src/detector.js` : logique de détection des états invitation
- `src/amazon-dom.js` : extraction des données produit depuis le DOM Amazon
- `src/scrape-amazon-product.js` : scraping des pages produit
- `src/scrape-amazon-listing.js` : scraping des pages listing

## Avertissement

amzinvite n'est pas affilié à Amazon. L'option d'auto-demande peut être contraire aux conditions d'utilisation d'Amazon. Utilisation à tes risques.

## Licence

MIT
