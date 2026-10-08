'use strict';

const products = require('./task-catalog');
const vipPlans = [
  { id: 'free', level: 0, name: 'Free VIP', price: 0, dailyTasks: 1, maxReward: 0.3, teamRate: 0, color: '#64748b', durationDays: 10 },
  { id: 'vip1', level: 1, name: 'VIP 1', price: 30, dailyTasks: 1, teamRate: 3, color: '#15966c' },
  { id: 'vip2', level: 2, name: 'VIP 2', price: 100, dailyTasks: 1, teamRate: 4, color: '#145cf6' },
  { id: 'vip3', level: 3, name: 'VIP 3', price: 300, dailyTasks: 1, teamRate: 5, color: '#8a56e8' },
  { id: 'vip4', level: 4, name: 'VIP 4', price: 800, dailyTasks: 1, teamRate: 6, color: '#d97706' },
  { id: 'vip5', level: 5, name: 'VIP 5', price: 1500, dailyTasks: 1, teamRate: 7, color: '#dc2626' },
  { id: 'vip6', level: 6, name: 'VIP 6', price: 3000, dailyTasks: 1, teamRate: 8, color: '#0891b2' },
  { id: 'vip7', level: 7, name: 'VIP 7', price: 5000, dailyTasks: 1, teamRate: 9, color: '#4f46e5' },
  { id: 'vip8', level: 8, name: 'VIP 8', price: 8000, dailyTasks: 1, teamRate: 10, color: '#be185d' },
  { id: 'vip9', level: 9, name: 'VIP 9', price: 12000, dailyTasks: 1, teamRate: 12, color: '#0f766e' },
  { id: 'vip10', level: 10, name: 'VIP 10', price: 18000, dailyTasks: 1, teamRate: 14, color: '#7c3aed' },
  { id: 'vip11', level: 11, name: 'VIP 11', price: 25000, dailyTasks: 1, teamRate: 15, color: '#b45309' }
].map(plan => ({ ...plan, durationDays: plan.durationDays || 365,
  maxReward: plan.price ? Math.round(plan.price / (11 * (1 - 0.1)) * 100) / 100 : plan.maxReward }));

const tasks = vipPlans.map(plan => ({ ...products[plan.level], id: `${plan.id}-daily-task`,
  icon: plan.level === 0 ? 'star' : 'crown', category: plan.level === 0 ? 'free' : plan.id,
  minutes: 3 + Math.min(plan.level, 8), reward: plan.maxReward, requiredVip: plan.level }));

module.exports = { vipPlans, tasks };
