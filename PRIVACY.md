# Privacy Policy — amzinvite

**Dernière mise à jour :** 2026-07-30

amzinvite est conçu pour fonctionner avec un minimum de données.

## Données stockées localement

Les informations suivantes restent dans le navigateur :

- `instanceId` : identifiant anonyme généré localement
- des credentials d'authentification aléatoires : un lié à l'instance et un
  credential court distinct pour les observations anonymes
- `intervalMin`, `autoRequest`, `communityDataEnabled`, `trackPokemonTcgFr` : préférences de l'extension
- `customUrls` : liens Amazon ajoutés manuellement
- `knownStates` : états détectés pour les produits suivis
- `publicFeed`, `lastRun`, `checkProgress`, `autoSpawnLog` : données internes de fonctionnement

Un reset complet est disponible depuis le popup.

## Données envoyées au service amzinvite

### Feed public

L'extension récupère la liste publique des produits en mode invitation.

### Partage anonyme

Quand l'option de partage anonyme est activée, l'extension peut envoyer :

- des détections d'état d'invitation
- certaines observations Amazon utiles à l'amélioration du catalogue

Ces envois sont conçus pour améliorer la qualité du service. Ils n'incluent pas de nom, d'email ou d'informations de paiement.

## Suivi automatique

Par défaut, amzinvite suit automatiquement les produits POKÉMON TCG FR via le feed public. Tu peux :

1. désactiver ce suivi automatique à tout moment (ce qui vide la liste des produits du feed)
2. ajouter des liens Amazon manuellement (conservés même si le feed est désactivé)
3. laisser le scraping fonctionner sans check automatique si aucun suivi n'est actif

## Données envoyées à Amazon

Si l'option **Auto-demander** est activée, l'extension peut envoyer la demande d'invitation directement à Amazon en utilisant la session Amazon déjà ouverte dans le navigateur.

## Contrôle utilisateur

Tu peux à tout moment :

1. désactiver le partage anonyme
2. désactiver l'auto-demande
3. supprimer les données locales via le bouton Reset
4. désinstaller l'extension

## Contact

Pour toute question liée à la confidentialité, utilise le dépôt GitHub officiel du projet.
