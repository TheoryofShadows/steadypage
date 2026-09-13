'use strict';

const LIMITS = {
  free: 1,
  pro: 20,
};

function monitorLimit(plan) {
  return LIMITS[plan] || LIMITS.free;
}

module.exports = { LIMITS, monitorLimit };
